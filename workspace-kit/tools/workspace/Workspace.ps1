[CmdletBinding()]
param(
    [ValidateSet('Check','Start','Close','MarkReady')][string]$Action = 'Check',
    [string]$Id,
    [string]$Owner,
    [ValidateSet('P0','P1','P2')][string]$Priority = 'P1',
    [string[]]$Scope,
    [string]$Acceptance,
    [switch]$Refresh,
    [string]$WorkspaceRoot = ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath($WorkspaceRoot)
$registryPath = Join-Path $root 'WORKSPACE.json'
$registry = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
$gitExe = $registry.tooling.gitExecutable
if (-not (Test-Path -LiteralPath $gitExe -PathType Leaf)) { throw 'Git not found at the configured path.' }
$repo = [IO.Path]::GetFullPath($registry.canonical.path)
if ($repo -ne (Join-Path $root 'project')) { throw 'Canonical must be this workspace project directory.' }
function ScopesOverlap([string]$left,[string]$right) {
    $a = $left.TrimEnd('/')
    $b = $right.TrimEnd('/')
    return $a.Equals($b,[StringComparison]::OrdinalIgnoreCase) -or $a.StartsWith($b + '/',[StringComparison]::OrdinalIgnoreCase) -or $b.StartsWith($a + '/',[StringComparison]::OrdinalIgnoreCase)
}
function RunGit([string]$path, [string[]]$arguments) {
    $output = @(& $gitExe -C $path -c core.quotepath=false @arguments)
    if ($LASTEXITCODE -ne 0) { throw "Git failed: $($arguments -join ' ')" }
    return $output
}
function CheckCanonical {
    if ($Refresh) { RunGit $repo @('fetch','origin') | Out-Null }
    if (((RunGit $repo @('branch','--show-current')) -join '') -ne 'main') { throw 'Canonical must remain on main.' }
    if (@(RunGit $repo @('status','--porcelain')).Count) { throw 'Canonical has local changes. Preserve them; do not reset.' }
    $head = (RunGit $repo @('rev-parse','HEAD')) -join ''
    $remote = (RunGit $repo @('rev-parse','origin/main')) -join ''
    if ($head -ne $remote) { throw 'Canonical differs from origin/main. Review and fast-forward it before starting work.' }
    if ($registry.canonical.verifiedCommit -ne $head) { throw 'Registry baseline needs a reviewed update.' }
}
function CheckTasks {
    $active = @($registry.tasks | Where-Object state -EQ 'active')
    if ($active.Count -gt $registry.policy.maxActiveTasks) { throw 'Active task limit exceeded.' }
    $listed = @(RunGit $repo @('worktree','list','--porcelain') | Where-Object { $_.StartsWith('worktree ') } | ForEach-Object { [IO.Path]::GetFullPath($_.Substring(9)) })
    $known = @($repo) + @($registry.tasks | ForEach-Object path) + @($registry.archives | ForEach-Object path)
    foreach ($path in $listed) { if ($known -notcontains $path) { throw "Unregistered worktree: $path" } }
    foreach ($path in $known) { if ($listed -notcontains $path) { throw "Registry path is not a Git worktree: $path" } }
    foreach ($task in $active) {
        if (-not ([IO.Path]::GetFullPath($task.path)).StartsWith((Join-Path $root '.worktrees') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Active task outside controlled directory.' }
        if (((RunGit $task.path @('branch','--show-current')) -join '') -ne $task.branch) { throw "Task branch mismatch: $($task.id)" }
        if (-not $task.owner -or -not $task.acceptance -or -not @($task.scope).Count) { throw "Incomplete task ownership: $($task.id)" }
        $dependencies = Join-Path $task.path 'node_modules'
        if (Test-Path -LiteralPath $dependencies) {
            if ((Get-Item -LiteralPath $dependencies -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Shared node_modules is forbidden: $($task.id)" }
        }
    }
    for ($i = 0; $i -lt $active.Count; $i++) {
        for ($j = $i + 1; $j -lt $active.Count; $j++) {
            foreach ($left in $active[$i].scope) { foreach ($right in $active[$j].scope) {
                if (ScopesOverlap $left $right) { throw 'Active task ownership overlaps in registry.' }
            } }
        }
    }
}
function SaveRegistry {
    $registry.updatedAt = [DateTime]::UtcNow.ToString('o')
    $temporary = $registryPath + '.tmp'
    $registry | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporary -Encoding utf8
    [IO.File]::Move($temporary, $registryPath, $true)
    if ($registry.PSObject.Properties['release']) {
        & (Join-Path $PSScriptRoot 'Render-Status.ps1') -WorkspaceRoot $root
    }
}
if ($Action -ne 'Check') {
    if ($Id -notmatch '^[a-z][a-z0-9-]{2,47}$') { throw 'Task ID must be 3-48 lowercase letters, digits or hyphens, starting with a letter.' }
}
$taskLock = [IO.File]::Open((Join-Path $root '.workspace.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    # Re-read only after taking the lock so simultaneous managers cannot overwrite each other.
    $registry = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
    CheckCanonical
    CheckTasks
    if ($Action -eq 'Check') {
        Write-Host "PASS: canonical main=$($registry.canonical.verifiedCommit.Substring(0,7)); active=$(@($registry.tasks | Where-Object state -EQ 'active').Count)/$($registry.policy.maxActiveTasks); archived=$(@($registry.archives).Count)."
        if (-not $Refresh) { Write-Host 'Remote freshness not checked; use -Refresh for a live fetch.' }
        exit
    }
    if ($Action -eq 'MarkReady') {
        $task = @($registry.tasks | Where-Object { $_.id -eq $Id -and $_.state -eq 'active' })
        if ($task.Count -ne 1) { throw 'Exactly one active task must match.' }
        $task = $task[0]
        if (@(RunGit $task.path @('status','--porcelain')).Count) { throw 'Commit and verify the task before marking it ready.' }
        $task | Add-Member -NotePropertyName phase -NotePropertyValue 'ready-for-local-review' -Force
        $task | Add-Member -NotePropertyName resultCommit -NotePropertyValue ((RunGit $task.path @('rev-parse','HEAD')) -join '') -Force
        SaveRegistry
        Write-Host "Ready for local review: $Id. Not merged or deployed."
    } elseif ($Action -eq 'Start') {
        if (-not $Refresh) { throw 'Starting a task requires -Refresh.' }
        if (-not $Owner -or -not $Acceptance -or -not $Scope.Count) { throw 'Owner, Scope and Acceptance are required.' }
        $active = @($registry.tasks | Where-Object state -EQ 'active')
        if ($active.Count -ge $registry.policy.maxActiveTasks) { throw 'Finish or archive an active task before starting another.' }
        if (@($registry.tasks | Where-Object id -EQ $Id).Count) { throw 'Task ID already exists.' }
        foreach ($area in $Scope) {
            if ($area -notmatch '^[a-zA-Z0-9_./-]+$' -or $area.StartsWith('/') -or $area.Contains('..')) { throw 'Scope must be a repository-relative file or directory, without wildcards.' }
            foreach ($task in $active) {
                foreach ($owned in $task.scope) {
                    if (ScopesOverlap $area $owned) { throw "Scope overlap with $($task.id): $area" }
                }
            }
        }
        $path = Join-Path $root ('.worktrees/' + $Id)
        if (Test-Path -LiteralPath $path) { throw 'Task path already exists.' }
        $branch = 'task/' + $Id
        New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
        RunGit $repo @('worktree','add','-b',$branch,$path,'origin/main') | Out-Null
        $registry.tasks = @($registry.tasks) + [pscustomobject]@{ id=$Id; path=$path; branch=$branch; state='active'; owner=$Owner; priority=$Priority; scope=@($Scope); acceptance=$Acceptance; baseCommit=$registry.canonical.verifiedCommit; startedAt=[DateTime]::UtcNow.ToString('o') }
        SaveRegistry
        Write-Host "Started $Id at $path. Install locked dependencies independently before runtime verification."
    } else {
        $task = @($registry.tasks | Where-Object { $_.id -eq $Id -and $_.state -eq 'active' })
        if ($task.Count -ne 1) { throw 'Exactly one active task must match.' }
        $task = $task[0]
        $sourcePath = [IO.Path]::GetFullPath($task.path)
        $destination = [IO.Path]::GetFullPath((Join-Path $root ('_workspace_archive/tasks/' + $Id)))
        if (Test-Path -LiteralPath $destination) { throw 'Archive destination already exists.' }
        if (-not $sourcePath.StartsWith((Join-Path $root '.worktrees') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe source path.' }
        if (-not $destination.StartsWith((Join-Path $root '_workspace_archive/tasks') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive path.' }
        $status = @(RunGit $task.path @('status','--porcelain=v1','--untracked-files=all'))
        $head = (RunGit $task.path @('rev-parse','HEAD')) -join ''
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        RunGit $repo @('worktree','move',$sourcePath,$destination) | Out-Null
        if (((RunGit $destination @('rev-parse','HEAD')) -join '') -ne $head -or ((@(RunGit $destination @('status','--porcelain=v1','--untracked-files=all'))) -join "`n") -cne ($status -join "`n")) { throw 'Archive verification failed; preserve both registry and files for recovery.' }
        RunGit $repo @('worktree','lock','--reason','Archived by workspace manager; restore through a new task',$destination) | Out-Null
        $task.state = 'archived-unmerged'
        $task.path = $destination
        $registry.archives = @($registry.archives) + [pscustomobject]@{ id=$Id; path=$destination; branch=$task.branch; head=$head; status=$status; state='archived-unmerged' }
        SaveRegistry
        Write-Host "Archived $Id with all files preserved. This does not certify merge or deployment."
    }
} finally { $taskLock.Dispose() }
