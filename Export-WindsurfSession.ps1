[CmdletBinding(DefaultParameterSetName = 'ExportLatest')]
param(
    [Parameter(ParameterSetName = 'ExportOne')]
    [ValidatePattern('^[0-9a-fA-F-]{36}$')]
    [string] $CascadeId,

    [Parameter(ParameterSetName = 'ExportAll')]
    [switch] $All,

    [Parameter(ParameterSetName = 'List')]
    [switch] $List,

    [string] $OutDir,

    [int] $Limit = 25,

    [switch] $IncludeTools,

    [switch] $JsonOnly,

    [switch] $MarkdownOnly,

    [switch] $AsJson,

    [int] $Port
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($OutDir)) {
    $OutDir = Join-Path $PSScriptRoot 'exports'
}

Import-Module (Join-Path $PSScriptRoot 'WindsurfSessionExport.psm1') -Force

function Add-ProcessEnvironmentReaderType {
    $typeName = 'WindsurfProcessEnvironmentReader'
    if ($typeName -as [type]) {
        return
    }

    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WindsurfProcessEnvironmentReader {
    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_BASIC_INFORMATION {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2_0;
        public IntPtr Reserved2_1;
        public IntPtr UniqueProcessId;
        public IntPtr Reserved3;
    }

    [DllImport("ntdll.dll")]
    public static extern int NtQueryInformationProcess(
        IntPtr processHandle,
        int processInformationClass,
        ref PROCESS_BASIC_INFORMATION processInformation,
        int processInformationLength,
        out int returnLength);

    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr OpenProcess(int desiredAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool ReadProcessMemory(
        IntPtr processHandle,
        IntPtr baseAddress,
        byte[] buffer,
        int size,
        out IntPtr bytesRead);

    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr handle);
}
'@
}

function Get-WindsurfLanguageServerProcess {
    $processes = Get-CimInstance Win32_Process |
        Where-Object { $_.Name -eq 'language_server_windows_x64.exe' } |
        Sort-Object CreationDate -Descending

    $process = $processes | Select-Object -First 1
    if (-not $process) {
        throw 'Could not find running language_server_windows_x64.exe. Please open Windsurf first.'
    }

    return $process
}

function Get-RemoteProcessEnvironmentValue {
    param(
        [Parameter(Mandatory = $true)]
        [int] $ProcessId,

        [Parameter(Mandatory = $true)]
        [string] $Name
    )

    Add-ProcessEnvironmentReaderType

    $PROCESS_QUERY_INFORMATION = 0x0400
    $PROCESS_VM_READ = 0x0010
    $handle = [WindsurfProcessEnvironmentReader]::OpenProcess(
        ($PROCESS_QUERY_INFORMATION -bor $PROCESS_VM_READ),
        $false,
        $ProcessId)

    if ($handle -eq [IntPtr]::Zero) {
        throw "Could not read Windsurf language server environment. OpenProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    try {
        $pbi = New-Object WindsurfProcessEnvironmentReader+PROCESS_BASIC_INFORMATION
        $returnLength = 0
        $status = [WindsurfProcessEnvironmentReader]::NtQueryInformationProcess(
            $handle,
            0,
            [ref] $pbi,
            [Runtime.InteropServices.Marshal]::SizeOf($pbi),
            [ref] $returnLength)
        if ($status -ne 0) {
            throw "NtQueryInformationProcess failed: $status"
        }

        $pointerSize = [IntPtr]::Size
        $buffer = New-Object byte[] $pointerSize
        $bytesRead = [IntPtr]::Zero
        $processParametersPointerOffset = if ($pointerSize -eq 8) { 0x20 } else { 0x10 }
        $processParametersAddress = [IntPtr]::Add($pbi.PebBaseAddress, $processParametersPointerOffset)

        if (-not [WindsurfProcessEnvironmentReader]::ReadProcessMemory($handle, $processParametersAddress, $buffer, $buffer.Length, [ref] $bytesRead)) {
            throw "ReadProcessMemory(ProcessParameters) failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
        }

        $processParameters = if ($pointerSize -eq 8) {
            [IntPtr] [BitConverter]::ToInt64($buffer, 0)
        } else {
            [IntPtr] [BitConverter]::ToInt32($buffer, 0)
        }

        $environmentPointerOffset = if ($pointerSize -eq 8) { 0x80 } else { 0x48 }
        $environmentPointerAddress = [IntPtr]::Add($processParameters, $environmentPointerOffset)
        if (-not [WindsurfProcessEnvironmentReader]::ReadProcessMemory($handle, $environmentPointerAddress, $buffer, $buffer.Length, [ref] $bytesRead)) {
            throw "ReadProcessMemory(Environment pointer) failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
        }

        $environmentPointer = if ($pointerSize -eq 8) {
            [IntPtr] [BitConverter]::ToInt64($buffer, 0)
        } else {
            [IntPtr] [BitConverter]::ToInt32($buffer, 0)
        }

        foreach ($size in 32768, 65536, 131072) {
            $environmentBytes = New-Object byte[] $size
            $bytesRead = [IntPtr]::Zero
            $ok = [WindsurfProcessEnvironmentReader]::ReadProcessMemory(
                $handle,
                $environmentPointer,
                $environmentBytes,
                $environmentBytes.Length,
                [ref] $bytesRead)
            if (-not $ok) {
                continue
            }

            $end = [int] $bytesRead
            for ($i = 0; $i -lt $end - 3; $i += 2) {
                if ($environmentBytes[$i] -eq 0 -and
                    $environmentBytes[$i + 1] -eq 0 -and
                    $environmentBytes[$i + 2] -eq 0 -and
                    $environmentBytes[$i + 3] -eq 0) {
                    $end = $i
                    break
                }
            }

            $environmentText = [Text.Encoding]::Unicode.GetString($environmentBytes, 0, $end)
            $prefix = "$Name="
            $line = $environmentText -split "`0" |
                Where-Object { $_.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } |
                Select-Object -First 1

            if ($line) {
                return $line.Substring($prefix.Length)
            }
        }

        throw "Could not find $Name in Windsurf language server environment."
    } finally {
        [void] [WindsurfProcessEnvironmentReader]::CloseHandle($handle)
    }
}

function Get-WindsurfListenPorts {
    param(
        [Parameter(Mandatory = $true)]
        [int] $ProcessId
    )

    $ports = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object {
            $_.OwningProcess -eq $ProcessId -and
            $_.LocalAddress -in @('127.0.0.1', '::1')
        } |
        Select-Object -ExpandProperty LocalPort -Unique |
        Sort-Object

    if (-not $ports) {
        throw "Windsurf language server process $ProcessId has no visible local listening ports."
    }

    return $ports
}

function Invoke-WindsurfRpc {
    param(
        [Parameter(Mandatory = $true)]
        [int] $Port,

        [Parameter(Mandatory = $true)]
        [string] $CsrfToken,

        [Parameter(Mandatory = $true)]
        [string] $Method,

        [Parameter(Mandatory = $true)]
        [hashtable] $Body
    )

    $headers = @{ 'x-codeium-csrf-token' = $CsrfToken }
    $uri = "http://127.0.0.1:$Port/exa.language_server_pb.LanguageServerService/$Method"
    $json = $Body | ConvertTo-Json -Depth 20 -Compress

    $request = [System.Net.HttpWebRequest] [System.Net.WebRequest]::Create($uri)
    $request.Method = 'POST'
    $request.Accept = 'application/json'
    $request.ContentType = 'application/json; charset=utf-8'
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 30000
    foreach ($header in $headers.GetEnumerator()) {
        $request.Headers.Add($header.Key, [string] $header.Value)
    }

    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $request.ContentLength = $bodyBytes.Length
    $requestStream = $request.GetRequestStream()
    try {
        $requestStream.Write($bodyBytes, 0, $bodyBytes.Length)
    } finally {
        $requestStream.Dispose()
    }

    try {
        $response = $request.GetResponse()
        try {
            $responseText = Read-Utf8Stream $response.GetResponseStream()
        } finally {
            $response.Dispose()
        }
    } catch [System.Net.WebException] {
        $errorResponse = $_.Exception.Response
        $errorText = ''
        if ($errorResponse) {
            try {
                $errorText = Read-Utf8Stream $errorResponse.GetResponseStream()
            } finally {
                $errorResponse.Dispose()
            }
        }
        throw "Windsurf RPC $Method failed: $($_.Exception.Message) $errorText"
    }

    if ([string]::IsNullOrWhiteSpace($responseText)) {
        return $null
    }

    return $responseText | ConvertFrom-Json
}

function Read-Utf8Stream {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.Stream] $Stream
    )

    $memory = New-Object System.IO.MemoryStream
    try {
        $buffer = New-Object byte[] 8192
        while ($true) {
            $read = $Stream.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) {
                break
            }
            $memory.Write($buffer, 0, $read)
        }
        return [System.Text.Encoding]::UTF8.GetString($memory.ToArray())
    } finally {
        $memory.Dispose()
        $Stream.Dispose()
    }
}

function Format-WindsurfTime {
    param(
        [AllowNull()]
        $Value
    )

    if ($null -eq $Value) {
        return ''
    }

    if ($Value -is [DateTime]) {
        return $Value.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ', [Globalization.CultureInfo]::InvariantCulture)
    }

    return [string] $Value
}

function Resolve-WindsurfRpcPort {
    param(
        [Parameter(Mandatory = $true)]
        [int[]] $CandidatePorts,

        [Parameter(Mandatory = $true)]
        [string] $CsrfToken
    )

    foreach ($candidatePort in $CandidatePorts) {
        try {
            [void] (Invoke-WindsurfRpc `
                -Port $candidatePort `
                -CsrfToken $CsrfToken `
                -Method 'GetAllCascadeTrajectories' `
                -Body @{ includeUserInputs = $false })
            return $candidatePort
        } catch {
            continue
        }
    }

    throw "Could not find available Windsurf RPC port in candidate ports: $($CandidatePorts -join ', ')"
}

function Get-TrajectorySummaries {
    param(
        [Parameter(Mandatory = $true)]
        [int] $RpcPort,

        [Parameter(Mandatory = $true)]
        [string] $CsrfToken
    )

    $response = Invoke-WindsurfRpc `
        -Port $RpcPort `
        -CsrfToken $CsrfToken `
        -Method 'GetAllCascadeTrajectories' `
        -Body @{ includeUserInputs = $false }

    $items = New-Object System.Collections.Generic.List[object]
    foreach ($property in $response.trajectorySummaries.PSObject.Properties) {
        $summary = $property.Value
        $workspacesProperty = $summary.PSObject.Properties['workspaces']
        $workspace = ''
        if ($workspacesProperty -and $workspacesProperty.Value) {
            $workspaces = @($workspacesProperty.Value)
            if ($workspaces.Count -gt 0) {
                $workspaceProperty = $workspaces[0].PSObject.Properties['workspaceFolderAbsoluteUri']
                if ($workspaceProperty) {
                    $workspace = [string] $workspaceProperty.Value
                }
            }
        }

        $createdProp = $summary.PSObject.Properties['createdTime']
        $createdVal = if ($createdProp) { $createdProp.Value } else { $null }
        $createdTime = Format-WindsurfTime $createdVal

        $modifiedProp = $summary.PSObject.Properties['lastModifiedTime']
        $modifiedVal = if ($modifiedProp) { $modifiedProp.Value } else { $null }
        $lastModifiedTime = Format-WindsurfTime $modifiedVal
        $items.Add([pscustomobject]@{
            CascadeId        = $property.Name
            Title            = [string] $summary.summary
            StepCount        = [int] $summary.stepCount
            Status           = [string] $summary.status
            CreatedTime      = $createdTime
            LastModifiedTime = $lastModifiedTime
            Workspace        = $workspace
        })
    }

    return $items | Sort-Object LastModifiedTime -Descending
}

function Export-OneSession {
    param(
        [Parameter(Mandatory = $true)]
        [object] $Summary,

        [Parameter(Mandatory = $true)]
        [int] $RpcPort,

        [Parameter(Mandatory = $true)]
        [string] $CsrfToken,

        [Parameter(Mandatory = $true)]
        [string] $Destination,

        [switch] $IncludeTools,

        [switch] $JsonOnly,

        [switch] $MarkdownOnly
    )

    $response = Invoke-WindsurfRpc `
        -Port $RpcPort `
        -CsrfToken $CsrfToken `
        -Method 'GetCascadeTranscriptForTrajectoryId' `
        -Body @{ cascadeId = $Summary.CascadeId; stepOffset = 0 }

    $messages = ConvertFrom-WindsurfTranscript `
        -Transcript ([string] $response.transcript) `
        -IncludeTools:$IncludeTools

    $safeTitle = ConvertTo-SafeFileName -Value $Summary.Title
    $datePrefix = if ($Summary.LastModifiedTime.Length -ge 10) { $Summary.LastModifiedTime.Substring(0, 10) } else { 'unknown-date' }
    $baseName = "$datePrefix`_$safeTitle`_$($Summary.CascadeId)"
    $baseName = ConvertTo-SafeFileName -Value $baseName -MaxLength 150
    $markdownPath = Join-Path $Destination "$baseName.md"
    $jsonPath = Join-Path $Destination "$baseName.json"

    if (-not $JsonOnly) {
        $markdown = ConvertTo-WindsurfSessionMarkdown `
            -CascadeId $Summary.CascadeId `
            -Title $Summary.Title `
            -Messages $messages `
            -NumTotalSteps ([int] $response.numTotalSteps)

        Set-Content -LiteralPath $markdownPath -Value $markdown -Encoding UTF8
    }

    if (-not $MarkdownOnly) {
        $jsonObject = [pscustomobject]@{
            cascadeId        = $Summary.CascadeId
            title            = $Summary.Title
            status           = $Summary.Status
            createdTime      = $Summary.CreatedTime
            lastModifiedTime = $Summary.LastModifiedTime
            workspace        = $Summary.Workspace
            numTotalSteps    = [int] $response.numTotalSteps
            includeTools     = [bool] $IncludeTools
            messages         = $messages
        }

        $jsonObject | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
    }

    return [pscustomobject]@{
        CascadeId = $Summary.CascadeId
        Title     = $Summary.Title
        Messages  = $messages.Count
        Markdown  = if ($JsonOnly) { '' } else { $markdownPath }
        Json      = if ($MarkdownOnly) { '' } else { $jsonPath }
    }
}

$process = Get-WindsurfLanguageServerProcess
$csrfToken = Get-RemoteProcessEnvironmentValue -ProcessId ([int] $process.ProcessId) -Name 'WINDSURF_CSRF_TOKEN'
$ports = if ($Port) { @($Port) } else { @(Get-WindsurfListenPorts -ProcessId ([int] $process.ProcessId)) }
$rpcPort = Resolve-WindsurfRpcPort -CandidatePorts $ports -CsrfToken $csrfToken
$summaries = @(Get-TrajectorySummaries -RpcPort $rpcPort -CsrfToken $csrfToken)

if ($List) {
    $listData = $summaries | Select-Object -First $Limit CascadeId, StepCount, Status, LastModifiedTime, Title, Workspace
    if ($AsJson) {
        ConvertTo-Json -InputObject @($listData) -Depth 5
    } else {
        $listData | Format-Table -AutoSize
    }
    return
}

if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

if ($All) {
    $targets = $summaries
} elseif ($CascadeId) {
    $targets = @($summaries | Where-Object { $_.CascadeId -eq $CascadeId })
    if (-not $targets) {
        throw "Could not find CascadeId: $CascadeId in local Windsurf."
    }
} else {
    $targets = @($summaries | Select-Object -First 1)
    if (-not $targets) {
        throw 'Local Windsurf returned no Cascade sessions.'
    }
}

$results = foreach ($summary in $targets) {
    Export-OneSession `
        -Summary $summary `
        -RpcPort $rpcPort `
        -CsrfToken $csrfToken `
        -Destination $OutDir `
        -IncludeTools:$IncludeTools `
        -JsonOnly:$JsonOnly `
        -MarkdownOnly:$MarkdownOnly
}

if ($AsJson) {
    ConvertTo-Json -InputObject @($results) -Depth 5
} else {
    $results | Format-Table -AutoSize
}
