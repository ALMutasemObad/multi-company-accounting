$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$path = Join-Path $root 'WORKSPACE.json'
if (Test-Path -LiteralPath $path) { throw 'Registry already exists; do not replace it.' }
$inventory = Get-Content -LiteralPath (Join-Path $root '_workspace_archive/inventory-before.json') -Raw | ConvertFrom-Json
$records = @(foreach ($wt in $inventory.worktrees) {
    if ($wt.source -eq $inventory.canonical) { continue }
    [pscustomobject]@{ id=(Split-Path $wt.destination -Leaf); originalPath=$wt.source; path=$wt.destination; branch=$wt.branch; head=$wt.head; dirtyEntries=@($wt.status).Count; state=if (@($wt.status).Count) { 'archived-needs-review' } else { 'archived-merge-not-certified' } }
})
$registry = [ordered]@{
    schemaVersion=1
    updatedAt=[DateTime]::UtcNow.ToString('o')
    repository='https://github.com/ALMutasemObad/multi-company-accounting.git'
    canonical=@{ path=$inventory.canonical; branch='main'; verifiedCommit=$inventory.originMain; verifiedAt=[DateTime]::UtcNow.ToString('o') }
    release=@{ environment='staging'; commit='8e68632ebe678ac94a5face4e78481a32fcab930'; pullRequest=50; ciRunId=33930498038; ciUrl='https://github.com/ALMutasemObad/multi-company-accounting/actions/runs/33930498038'; ciEvidence='tools/workspace/evidence/ci-33930498038.json'; currentHealthCheckPerformed=$false; deploymentPermissionForNewChanges=$false }
    tooling=@{ gitExecutable=(Get-Command git.exe).Source; dependencyPolicy='Per-task node_modules; shared download cache only; regenerate Prisma after schema changes' }
    policy=@{ maxActiveTasks=3; taskRoot=(Join-Path $root '.worktrees'); canonicalReadOnly=$true; noAutomaticPush=$true; noAutomaticDeployment=$true }
    tasks=@()
    archives=$records
    preservation=@{ inventory='_workspace_archive/inventory-before.json'; gitBundle='_workspace_archive/repository-before.bundle'; gitBundleSha256=(Get-FileHash -LiteralPath (Join-Path $root '_workspace_archive/repository-before.bundle')).Hash; note='The Git bundle does not contain uncommitted or ignored files; preserved worktree directories do.' }
}
$registry | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $path -Encoding utf8
Write-Host 'Created authoritative local workspace registry.'
