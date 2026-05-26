$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\WindsurfSessionExport.psm1'
Import-Module $modulePath -Force

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)] $Actual,
        [Parameter(Mandatory = $true)] $Expected,
        [Parameter(Mandatory = $true)] [string] $Message
    )

    if ($Actual -ne $Expected) {
        throw "$Message`nExpected: <$Expected>`nActual:   <$Actual>"
    }
}

$sampleTranscript = @'
=== MESSAGE 0 - Tool ===
[CORTEX_STEP_TYPE_RETRIEVE_MEMORY]

=== MESSAGE 1 - User ===
第一条用户问题
第二行

=== MESSAGE 2 - Assistant ===
第一条回答

=== MESSAGE 3 - Tool ===
[CORTEX_STEP_TYPE_VIEW_FILE]
some noisy tool payload

=== MESSAGE 4 - User ===
继续

=== MESSAGE 5 - Assistant ===
好的，继续。
'@

$messages = ConvertFrom-WindsurfTranscript -Transcript $sampleTranscript

Assert-Equal $messages.Count 4 'keeps only user and assistant messages by default'
Assert-Equal $messages[0].Role 'User' 'first clean message role'
Assert-Equal $messages[0].Text "第一条用户问题`n第二行" 'preserves multiline user text'
Assert-Equal $messages[1].Role 'Assistant' 'second clean message role'
Assert-Equal $messages[2].Index 4 'keeps source message index'
Assert-Equal ($messages | Where-Object Role -eq 'Tool').Count 0 'drops tool messages'

$allMessages = ConvertFrom-WindsurfTranscript -Transcript $sampleTranscript -IncludeTools
Assert-Equal $allMessages.Count 6 'can include tool messages when requested'

$markdown = ConvertTo-WindsurfSessionMarkdown `
    -CascadeId '86f62e25-f2e5-4d3f-9513-b65bc750e117' `
    -Title 'Playwright Headed Browser' `
    -Messages $messages `
    -NumTotalSteps 297

if ($markdown -notmatch '^# Playwright Headed Browser') {
    throw 'markdown uses the title as top heading'
}

if ($markdown -match 'CORTEX_STEP_TYPE') {
    throw 'markdown should not contain tool step markers by default'
}

if ($markdown -notmatch '## User 1' -or $markdown -notmatch '## Assistant 1') {
    throw 'markdown includes clean role headings'
}

Write-Host 'transcript parser tests passed'
