param([string]$WorkspaceRoot = ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))))
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($WorkspaceRoot)
$registry = Get-Content -LiteralPath (Join-Path $root 'WORKSPACE.json') -Raw | ConvertFrom-Json
$status = @(
    '# حالة التنسيق الحالية',
    '',
    '> ملف مولّد من WORKSPACE.json بواسطة tools/workspace/Render-Status.ps1. لا يعدّل يدويًا.',
    '',
    "- المستودع المعتمد: $($registry.repository)",
    "- النسخة المرجعية المحلية: $($registry.canonical.path)",
    "- الفرع المرجعي: $($registry.canonical.branch)",
    "- آخر التزام main متحقق منه: $($registry.canonical.verifiedCommit)",
    "- البيئة المنشورة المسجلة: $($registry.release.environment)، PR$($registry.release.pullRequest)",
    "- دليل CI والنشر: $($registry.release.ciUrl)",
    '- لا يتضمن هذا التنظيم تحققًا حيًا جديدًا من صحة الموقع، ولا ترقية إلى الإنتاج.',
    "- المهام النشطة: $(@($registry.tasks | Where-Object state -EQ 'active').Count) / $($registry.policy.maxActiveTasks)",
    "- مساحات العمل المؤرشفة: $(@($registry.archives).Count)، مع الحفاظ على الفروع والتغييرات؛ ليست كلها مصدّقًا على دمجها.",
    '- لا إذن نشر جديد. لم يدفع هذا التنظيم أي تعديل إلى GitHub.',
    '',
    '## المهام الحالية',
    ''
)
foreach ($task in @($registry.tasks | Where-Object state -EQ 'active')) {
    $status += "- $($task.id) — $($task.priority) — $($task.owner) — $($task.branch) — $($task.path)"
    if ($task.phase) { $status += "  حالة النتيجة: $($task.phase)؛ الالتزام المحلي: $($task.resultCommit). لم يدمج أو ينشر." }
}
$status += @('', "آخر تحديث للسجل: $($registry.updatedAt)", '', 'ابدأ من START_HERE_AR.md؛ الأرشيف واللقطات السابقة ليست حالة حالية.')
$status | Set-Content -LiteralPath (Join-Path $root 'COORDINATION_STATUS_AR.md') -Encoding utf8
