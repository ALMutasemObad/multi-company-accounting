#Requires -Version 7.0
param([string]$WorkspaceRoot = ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))))
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($WorkspaceRoot)
$registry = Get-Content -LiteralPath (Join-Path $root 'WORKSPACE.json') -Raw | ConvertFrom-Json
$healthText = if ($registry.release.currentHealthCheckPerformed) { '- فحص حي مسجل للواجهة ونقاط الصحة؛ تفاصيله في دليل الإصدار. يبقى تصنيف البيئة كما هو أعلاه.' } else { '- لم يسجل فحص صحة حي جديد لهذه الجولة؛ لا يستنتج من نجاح CI وحده.' }
$permissionText = if ($registry.release.deploymentPermissionForNewChanges) { '- يوجد إذن نشر لهذه الدفعة المسجلة فقط؛ لا يمتد إلى دفعات لاحقة.' } else { '- لا يوجد إذن مفتوح لنشر تعديلات جديدة؛ كل دفعة لاحقة تحتاج إذنًا مستقلًا.' }
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
    $healthText,
    "- المهام النشطة: $(@($registry.tasks | Where-Object state -EQ 'active').Count) / $($registry.policy.maxActiveTasks)",
    "- مساحات العمل المؤرشفة: $(@($registry.archives).Count)، مع الحفاظ على الفروع والتغييرات؛ ليست كلها مصدّقًا على دمجها.",
    $permissionText,
    '',
    '## المهام الحالية',
    ''
)
foreach ($task in @($registry.tasks | Where-Object state -EQ 'active')) {
    $status += "- $($task.id) — $($task.priority) — $($task.owner) — $($task.branch) — $($task.path)"
    if ($task.PSObject.Properties['phase'] -and $task.phase) { $status += "  حالة النتيجة: $($task.phase)؛ التزام النتيجة: $($task.resultCommit). حالة النشر تؤخذ من سجل الإصدار أعلاه." }
}
$status += @('', "آخر تحديث للسجل: $($registry.updatedAt)", '', 'ابدأ من START_HERE_AR.md؛ الأرشيف واللقطات السابقة ليست حالة حالية.')
$status | Set-Content -LiteralPath (Join-Path $root 'COORDINATION_STATUS_AR.md') -Encoding utf8
