Set-StrictMode -Version Latest

function ConvertFrom-WindsurfTranscript {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string] $Transcript,

        [switch] $IncludeTools
    )

    $pattern = '(?m)^=== MESSAGE (?<index>\d+) - (?<role>[^=]+?) ===\s*$'
    $matches = [regex]::Matches($Transcript, $pattern)
    $messages = New-Object System.Collections.Generic.List[object]

    for ($i = 0; $i -lt $matches.Count; $i++) {
        $match = $matches[$i]
        $start = $match.Index + $match.Length
        $end = if ($i + 1 -lt $matches.Count) { $matches[$i + 1].Index } else { $Transcript.Length }
        $length = [Math]::Max(0, $end - $start)
        $text = $Transcript.Substring($start, $length).Trim()
        $role = $match.Groups['role'].Value.Trim()

        if (-not $IncludeTools -and $role -notin @('User', 'Assistant')) {
            continue
        }

        $messages.Add([pscustomobject]@{
            Index = [int] $match.Groups['index'].Value
            Role  = $role
            Text  = $text
        })
    }

    return $messages
}

function ConvertTo-WindsurfSessionMarkdown {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $CascadeId,

        [string] $Title,

        [Parameter(Mandatory = $true)]
        [object[]] $Messages,

        [int] $NumTotalSteps = 0
    )

    $heading = if ([string]::IsNullOrWhiteSpace($Title)) { $CascadeId } else { $Title.Trim() }
    $builder = [System.Text.StringBuilder]::new()
    [void] $builder.AppendLine("# $heading")
    [void] $builder.AppendLine()
    [void] $builder.AppendLine("- CascadeId: ``$CascadeId``")
    if ($NumTotalSteps -gt 0) {
        [void] $builder.AppendLine("- TotalSteps: $NumTotalSteps")
    }
    [void] $builder.AppendLine("- ExportedAt: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))")
    [void] $builder.AppendLine()

    $roleCounts = @{}
    foreach ($message in $Messages) {
        $role = [string] $message.Role
        if (-not $roleCounts.ContainsKey($role)) {
            $roleCounts[$role] = 0
        }
        $roleCounts[$role]++

        [void] $builder.AppendLine("## $role $($roleCounts[$role])")
        [void] $builder.AppendLine()
        [void] $builder.AppendLine(([string] $message.Text).Trim())
        [void] $builder.AppendLine()
    }

    return $builder.ToString().TrimEnd() + [Environment]::NewLine
}

function ConvertTo-SafeFileName {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Value,

        [int] $MaxLength = 80
    )

    $invalid = [IO.Path]::GetInvalidFileNameChars()
    $chars = foreach ($char in $Value.Trim().ToCharArray()) {
        if ($invalid -contains $char) { '_' } else { $char }
    }
    $name = (-join $chars) -replace '\s+', ' '
    $name = $name.Trim(' ', '.')

    if ([string]::IsNullOrWhiteSpace($name)) {
        return 'untitled'
    }

    if ($name.Length -gt $MaxLength) {
        return $name.Substring(0, $MaxLength).Trim(' ', '.')
    }

    return $name
}

Export-ModuleMember -Function `
    ConvertFrom-WindsurfTranscript, `
    ConvertTo-WindsurfSessionMarkdown, `
    ConvertTo-SafeFileName
