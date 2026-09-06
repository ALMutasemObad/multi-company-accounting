#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$manager = Join-Path $PSScriptRoot 'Workspace.ps1'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$fixture = Join-Path $root ('_workspace_archive/selftests/' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture -Force | Out-Null
$gitExe = (Get-Command git.exe).Source
function TestGit([string]$path,[string[]]$arguments) {
    & $gitExe -C $path @arguments 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Fixture Git failed: $($arguments -join ' ')" }
}
$repo = Join-Path $fixture 'project'
$remote = Join-Path $fixture 'origin.git'
New-Item -ItemType Directory -Path $repo,$remote | Out-Null
TestGit $remote @('init','--bare','--initial-branch=main')
TestGit $repo @('init','--initial-branch=main')
TestGit $repo @('config','user.name','Workspace Selftest')
TestGit $repo @('config','user.email','selftest@example.invalid')
TestGit $repo @('commit','--allow-empty','-m','Test baseline')
TestGit $repo @('remote','add','origin',$remote)
TestGit $repo @('push','-u','origin','main') # Local filesystem test fixture only; never GitHub.
$head = (& $gitExe -C $repo rev-parse HEAD).Trim()
$registryPath = Join-Path $fixture 'WORKSPACE.json'
$registry = @{ updatedAt=[DateTime]::UtcNow.ToString('o'); canonical=@{ path=$repo; verifiedCommit=$head }; tooling=@{ gitExecutable=$gitExe }; policy=@{ maxActiveTasks=3 }; tasks=@(); archives=@() }
$registry | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $registryPath -Encoding utf8
$results = [Collections.Generic.List[object]]::new()
function ExpectFailure([string]$name,[scriptblock]$operation,[string]$pattern) {
    $failed = $false
    try { & $operation } catch {
        if ($_.Exception.Message -notmatch $pattern) { throw "Wrong failure for ${name}: $($_.Exception.Message)" }
        $failed = $true
    }
    if (-not $failed) { throw "Expected failure did not occur: $name" }
    $results.Add(@{ name=$name; result='pass' })
}
& $manager -WorkspaceRoot $fixture -Action Check -Refresh
$results.Add(@{ name='clean canonical accepted'; result='pass' })
ExpectFailure 'path traversal rejected' { & $manager -WorkspaceRoot $fixture -Action Start -Id '../escape' } 'Task ID'
ExpectFailure 'freshness required' { & $manager -WorkspaceRoot $fixture -Action Start -Id 'missing-refresh' -Owner test -Scope docs -Acceptance test } 'requires -Refresh'
& $manager -WorkspaceRoot $fixture -Action Start -Refresh -Id task-one -Owner test -Scope docs -Acceptance test
ExpectFailure 'dot prefix cannot bypass scope ownership' { & $manager -WorkspaceRoot $fixture -Action Start -Refresh -Id task-dot -Owner test -Scope './docs' -Acceptance test } 'normalized repository-relative'
ExpectFailure 'root dot scope rejected' { & $manager -WorkspaceRoot $fixture -Action Start -Refresh -Id task-root -Owner test -Scope '.' -Acceptance test } 'normalized repository-relative'
ExpectFailure 'overlapping ownership rejected, including Windows case' { & $manager -WorkspaceRoot $fixture -Action Start -Refresh -Id task-two -Owner test -Scope DOCS/subdir -Acceptance test } 'Scope overlap'
& $manager -WorkspaceRoot $fixture -Action Start -Refresh -Id task-two -Owner test -Scope apps/api -Acceptance test
& $manager -WorkspaceRoot $fixture -Action Start -Refresh -Id task-three -Owner test -Scope apps/web -Acceptance test
ExpectFailure 'fourth active task rejected' { & $manager -WorkspaceRoot $fixture -Action Start -Refresh -Id task-four -Owner test -Scope packages -Acceptance test } 'Finish or archive'
$dirtyFile = Join-Path $fixture '.worktrees/task-one/preserved.txt'
'Uncommitted test fixture; must survive archival.' | Set-Content -LiteralPath $dirtyFile -Encoding utf8
$hash = (Get-FileHash -LiteralPath $dirtyFile).Hash
ExpectFailure 'dirty task cannot be marked ready' { & $manager -WorkspaceRoot $fixture -Action MarkReady -Id task-one } 'Commit and verify'
& $manager -WorkspaceRoot $fixture -Action MarkReady -Id task-two
$marked = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
$markedTask = $marked.tasks | Where-Object id -EQ 'task-two'
if ($markedTask.phase -ne 'ready-for-local-review' -or $markedTask.resultCommit -ne $head) { throw 'Ready result was not recorded correctly' }
$results.Add(@{ name='ready result captures clean commit'; result='pass' })
TestGit (Join-Path $fixture '.worktrees/task-two') @('commit','--allow-empty','-m','Changed after review')
ExpectFailure 'stale ready commit rejected' { & $manager -WorkspaceRoot $fixture -Action Check } 'Ready result is stale'
& $manager -WorkspaceRoot $fixture -Action MarkReady -Id task-two
New-Item -ItemType Directory -Path (Join-Path $fixture '.worktrees/task-one/local-package') | Out-Null
New-Item -ItemType Junction -Path (Join-Path $fixture '.worktrees/task-one/package-link') -Target (Join-Path $fixture '.worktrees/task-one/local-package') | Out-Null
& $manager -WorkspaceRoot $fixture -Action Close -Id task-one
if ((Get-FileHash -LiteralPath (Join-Path $fixture '_workspace_archive/tasks/task-one/preserved.txt')).Hash -ne $hash) { throw 'Dirty file lost' }
$results.Add(@{ name='dirty close preserves bytes'; result='pass' })
$archivedLink = Get-Item -LiteralPath (Join-Path $fixture '_workspace_archive/tasks/task-one/package-link')
if ([string]$archivedLink.Target -ne (Join-Path $fixture '_workspace_archive/tasks/task-one/local-package') -or -not (Test-Path -LiteralPath $archivedLink.Target)) { throw 'Internal junction was broken by archive move' }
$results.Add(@{ name='internal dependency junction survives archival'; result='pass' })
$dependencyTarget = Join-Path $fixture 'shared-dependencies'
New-Item -ItemType Directory -Path $dependencyTarget | Out-Null
$junction = Join-Path $fixture '.worktrees/task-two/node_modules'
New-Item -ItemType Junction -Path $junction -Target $dependencyTarget | Out-Null
ExpectFailure 'shared dependencies rejected' { & $manager -WorkspaceRoot $fixture -Action Check } 'Shared node_modules'
# Remove only this validated test junction object; never its target or the test directory.
if (-not $junction.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase) -or -not ((Get-Item -LiteralPath $junction).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe test junction' }
[IO.Directory]::Delete($junction)
TestGit $repo @('worktree','add','-b','unregistered',(Join-Path $fixture 'rogue'),'main')
ExpectFailure 'unregistered worktree rejected' { & $manager -WorkspaceRoot $fixture -Action Check } 'Unregistered worktree'
TestGit $repo @('worktree','lock','--reason','Selftest evidence',(Join-Path $fixture 'rogue'))
$renderRegistry = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
$renderRegistry | Add-Member -NotePropertyName repository -NotePropertyValue 'local-selftest'
$renderRegistry.canonical | Add-Member -NotePropertyName branch -NotePropertyValue main
$renderRegistry | Add-Member -NotePropertyName release -NotePropertyValue @{ environment='staging'; pullRequest=0; ciUrl='local-evidence'; currentHealthCheckPerformed=$true; deploymentPermissionForNewChanges=$false }
$renderRegistry | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $registryPath -Encoding utf8
& (Join-Path $PSScriptRoot 'Render-Status.ps1') -WorkspaceRoot $fixture
$rendered = Get-Content -LiteralPath (Join-Path $fixture 'COORDINATION_STATUS_AR.md') -Raw
if ($rendered -notmatch 'فحص حي مسجل' -or $rendered -match 'لم يدفع هذا التنظيم') { throw 'Report does not reflect deployment evidence' }
$results.Add(@{ name='report reflects current health and permission fields'; result='pass' })
$result = @{ fixture=$fixture; at=[DateTime]::UtcNow.ToString('o'); passed=$results.Count; cases=$results; note='Local disposable repository only. Retained as evidence; no production code or remote service changed.' }
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'tools/workspace/evidence/selftest-latest.json') -Encoding utf8
Write-Host "PASS: $($results.Count) workspace lifecycle and safety tests. Fixture retained at $fixture"
