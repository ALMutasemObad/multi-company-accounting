# Dot-source this file to make the discovered Git executable available in this shell only.
$taskWorkspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskRegistry = Get-Content -LiteralPath (Join-Path $taskWorkspaceRoot 'WORKSPACE.json') -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $taskRegistry.tooling.gitExecutable -PathType Leaf)) { throw 'Configured Git is missing; update WORKSPACE.json after locating an installed Git.' }
$taskGitDirectory = Split-Path $taskRegistry.tooling.gitExecutable -Parent
if (($env:PATH -split ';') -notcontains $taskGitDirectory) { $env:PATH = $taskGitDirectory + ';' + $env:PATH }
Set-Location -LiteralPath $taskWorkspaceRoot
Write-Host 'Git is available in this shell. No machine-wide PATH was changed.'
