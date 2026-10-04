[CmdletBinding()]
param(
    [string]$Revision = "main",
    [ValidateSet("zh_CN", "ja_JP", "en_US", "ko_KR")]
    [string[]]$Languages = @("zh_CN", "ja_JP", "en_US", "ko_KR"),
    [switch]$UseExisting
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceUrl = "https://github.com/050644zf/ArknightsStoryJson.git"
$destination = Join-Path $projectRoot "data/raw/arknights-story-json"
$manifestPath = Join-Path $projectRoot "data/raw/manifests/arknights-story-json.json"
$Languages = @($Languages | Select-Object -Unique)
if ($Languages.Count -eq 0) { throw "Select at least one language." }

$tables = @(
    "character_table.json", "handbook_info_table.json", "charword_table.json",
    "story_table.json", "story_review_table.json", "uniequip_table.json",
    "skin_table.json", "activity_table.json"
)
$metadataFiles = @("chardict.json", "charinfo.json", "storyinfo.json", "wordcount.json", "extrastory.json")
$languageCodes = @{ zh_CN = "zh"; ja_JP = "ja"; en_US = "en"; ko_KR = "ko" }
$serverRegions = @{ zh_CN = "cn"; ja_JP = "jp"; en_US = "en"; ko_KR = "kr" }

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & git @Arguments
    if ($LASTEXITCODE -ne 0) { throw "git command failed: git $($Arguments -join ' ')" }
}

if (-not (Test-Path -LiteralPath $destination)) {
    if ($UseExisting) { throw "Story JSON checkout not found: $destination" }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Invoke-Git clone --depth 1 --filter=blob:none --no-checkout $sourceUrl $destination
    # Preserve the upstream file bytes instead of converting line endings on Windows.
    Invoke-Git -C $destination config core.autocrlf false
}

if (-not (Test-Path -LiteralPath (Join-Path $destination ".git"))) {
    throw "Destination is not a Git checkout: $destination"
}
$actualRemote = & git -C $destination remote get-url origin
if ($LASTEXITCODE -ne 0 -or $actualRemote.Trim() -ne $sourceUrl) {
    throw "Unexpected origin URL in $destination"
}
$dirty = & git -C $destination status --porcelain --untracked-files=all
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect checkout status." }
# A clone made with --no-checkout has only .git and reports every file as deleted.
# It is safe to initialize that empty checkout, including after an interrupted first run.
$workingEntries = @(Get-ChildItem -LiteralPath $destination -Force | Where-Object { $_.Name -ne ".git" })
if ($dirty -and $workingEntries.Count -gt 0) {
    throw "Story JSON checkout contains local changes; preserve them before acquisition."
}

$sparsePaths = @(
    foreach ($locale in $Languages) {
        "/$locale/gamedata/story/"
        foreach ($table in $tables) { "/$locale/gamedata/excel/$table" }
        foreach ($metadataFile in $metadataFiles) { "/$locale/$metadataFile" }
    }
)

if (-not $UseExisting) {
    # Retain languages already collected when expanding a previous sparse checkout.
    foreach ($locale in @("zh_CN", "ja_JP", "en_US", "ko_KR")) {
        if ((Test-Path -LiteralPath (Join-Path $destination "$locale/gamedata/story")) -and $locale -notin $Languages) {
            $Languages += $locale
            $sparsePaths += "/$locale/gamedata/story/"
            foreach ($table in $tables) { $sparsePaths += "/$locale/gamedata/excel/$table" }
            foreach ($metadataFile in $metadataFiles) { $sparsePaths += "/$locale/$metadataFile" }
        }
    }
    Invoke-Git -C $destination fetch --depth 1 origin $Revision
    Invoke-Git -C $destination sparse-checkout init --no-cone
    Invoke-Git -C $destination sparse-checkout set --no-cone @sparsePaths
    Invoke-Git -C $destination checkout --detach FETCH_HEAD
}

$commit = & git -C $destination rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw "Unable to read source commit." }
$commitDate = & git -C $destination show -s --format=%cI HEAD
if ($LASTEXITCODE -ne 0) { throw "Unable to read source commit date." }

$inventory = @(
    foreach ($locale in $Languages) {
        $storyDirectory = Join-Path $destination "$locale/gamedata/story"
        if (-not (Test-Path -LiteralPath $storyDirectory)) { throw "Missing story directory: $locale" }
        $storyFiles = @(Get-ChildItem -LiteralPath $storyDirectory -Recurse -File -Filter "*.json")
        if ($storyFiles.Count -eq 0) { throw "No story JSON files for $locale" }
        $supportFiles = @(
            foreach ($table in $tables) { "$locale/gamedata/excel/$table" }
            foreach ($metadataFile in $metadataFiles) { "$locale/$metadataFile" }
        )
        [ordered]@{
            locale = $locale
            language = $languageCodes[$locale]
            region = $serverRegions[$locale]
            storyFileCount = $storyFiles.Count
            storyBytes = [long](($storyFiles | Measure-Object Length -Sum).Sum)
            supportFiles = @(
                foreach ($relativePath in $supportFiles) {
                    $filePath = Join-Path $destination $relativePath
                    if (-not (Test-Path -LiteralPath $filePath)) { throw "Required file missing: $relativePath" }
                    $file = Get-Item -LiteralPath $filePath
                    [ordered]@{
                        path = $relativePath
                        bytes = [long]$file.Length
                        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $filePath).Hash.ToLowerInvariant()
                    }
                }
            )
        }
    }
)

$manifest = [ordered]@{
    schemaVersion = 1
    source = [ordered]@{
        name = "050644zf/ArknightsStoryJson"
        url = $sourceUrl
        requestedRevision = $Revision
        usedExistingCheckout = [bool]$UseExisting
        commit = $commit.Trim()
        commitDate = $commitDate.Trim()
        retrievedAtUtc = [DateTime]::UtcNow.ToString("o")
        storyFormat = "astr-parsed-json"
        storyConverter = "https://github.com/050644zf/ASTR-Script"
        originalStoryTxtCommit = $null
        localPath = "data/raw/arknights-story-json"
    }
    selection = $sparsePaths
    inventory = $inventory
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $manifestPath) | Out-Null
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Host "Multilingual story JSON is ready."
Write-Host "Commit: $($commit.Trim())"
foreach ($languageInventory in $inventory) {
    Write-Host "$($languageInventory.locale): $($languageInventory.storyFileCount) story files"
}
Write-Host "Manifest: $manifestPath"
