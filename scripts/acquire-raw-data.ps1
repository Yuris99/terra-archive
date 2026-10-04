[CmdletBinding()]
param(
    [string]$SourceUrl = "https://github.com/ArknightsAssets/ArknightsGamedata.git",
    [string]$Revision = "master",
    [string]$Destination,
    [switch]$UseExisting
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) {
    $Destination = Join-Path $projectRoot "data/raw/arknights-gamedata"
}
$Destination = [System.IO.Path]::GetFullPath($Destination)
$destinationParent = Split-Path -Parent $Destination
$manifestDirectory = Join-Path $projectRoot "data/raw/manifests"
$manifestPath = Join-Path $manifestDirectory "arknights-gamedata-kr.json"

$sparsePaths = @(
    "/kr/gamedata/story/"
    "/kr/gamedata/excel/character_table.json"
    "/kr/gamedata/excel/handbook_info_table.json"
    "/kr/gamedata/excel/charword_table.json"
    "/kr/gamedata/excel/story_table.json"
    "/kr/gamedata/excel/story_review_table.json"
    "/kr/gamedata/excel/uniequip_table.json"
    "/kr/gamedata/excel/skin_table.json"
    "/kr/gamedata/excel/activity_table.json"
)

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git command failed: git $($Arguments -join ' ')"
    }
}

if (-not (Test-Path $Destination)) {
    if ($UseExisting) {
        throw "Raw checkout not found: $Destination"
    }

    New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
    Invoke-Git clone --depth 1 --filter=blob:none --no-checkout $SourceUrl $Destination
}

if (-not (Test-Path (Join-Path $Destination ".git"))) {
    throw "Destination is not a Git checkout: $Destination"
}

$actualRemote = (& git -C $Destination remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read origin URL from $Destination"
}
if ($actualRemote -ne $SourceUrl) {
    throw "Unexpected origin URL. Expected '$SourceUrl', found '$actualRemote'."
}

$dirty = & git -C $Destination status --porcelain
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect raw checkout status."
}
if ($dirty) {
    throw "Raw checkout contains local changes. Preserve or discard them before acquisition."
}

if (-not $UseExisting) {
    Invoke-Git -C $Destination fetch --depth 1 origin $Revision
    Invoke-Git -C $Destination sparse-checkout init --no-cone
    Invoke-Git -C $Destination sparse-checkout set --no-cone @sparsePaths
    Invoke-Git -C $Destination checkout --detach FETCH_HEAD
}

$requiredFiles = @(
    "kr/gamedata/excel/character_table.json"
    "kr/gamedata/excel/handbook_info_table.json"
    "kr/gamedata/excel/charword_table.json"
    "kr/gamedata/excel/story_table.json"
    "kr/gamedata/excel/story_review_table.json"
    "kr/gamedata/excel/uniequip_table.json"
    "kr/gamedata/excel/skin_table.json"
    "kr/gamedata/excel/activity_table.json"
)

foreach ($relativePath in $requiredFiles) {
    if (-not (Test-Path (Join-Path $Destination $relativePath))) {
        throw "Required file is missing: $relativePath"
    }
}

$storyRoot = Join-Path $Destination "kr/gamedata/story"
if (-not (Test-Path $storyRoot)) {
    throw "Required story directory is missing: $storyRoot"
}

$commit = (& git -C $Destination rev-parse HEAD).Trim()
$commitDate = (& git -C $Destination show -s --format=%cI HEAD).Trim()
$storyFiles = @(Get-ChildItem $storyRoot -Recurse -File)
$excelFiles = @($requiredFiles | ForEach-Object { Get-Item (Join-Path $Destination $_) })

$manifest = [ordered]@{
    schemaVersion = 1
    source = [ordered]@{
        name = "ArknightsAssets/ArknightsGamedata"
        url = $SourceUrl
        requestedRevision = $Revision
        usedExistingCheckout = [bool]$UseExisting
        commit = $commit
        commitDate = $commitDate
        retrievedAtUtc = [DateTime]::UtcNow.ToString("o")
        region = "kr"
    }
    selection = $sparsePaths
    inventory = [ordered]@{
        storyFileCount = $storyFiles.Count
        storyBytes = [long](($storyFiles | Measure-Object Length -Sum).Sum)
        excelFiles = @($excelFiles | Sort-Object Name | ForEach-Object {
            [ordered]@{
                name = $_.Name
                bytes = [long]$_.Length
                sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
            }
        })
    }
}

New-Item -ItemType Directory -Force -Path $manifestDirectory | Out-Null
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Host "Raw Korean data is ready."
Write-Host "Commit:  $commit"
Write-Host "Stories: $($storyFiles.Count) files"
Write-Host "Manifest: $manifestPath"
