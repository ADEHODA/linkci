# Sync LINK CI local → PythonAnywhere
$token = "ce70c0101a10765b13b4ee231ecf8cdb68572f32"
$user = "qasade"
$base = "https://www.pythonanywhere.com/api/v0/user/$user/files/path/home/$user/linkci"

$PROJECT = Split-Path $MyInvocation.MyCommand.Path
$FILES = @(
    "app.py", "run.py", "static/css/style.css", "static/js/app.js",
    "static/images/logo.svg", "static/images/favicon.svg"
)
$TEMPLATES = @(
    "index.html", "feed.html", "connexion.html", "inscription.html",
    "profil.html", "modifier_profil.html", "messagerie.html",
    "bourses.html", "ajouter_bourse.html", "formations.html",
    "ajouter_formation.html", "detail_formation.html",
    "documents.html", "notifications.html",
    "sondage.html", "sondage_resultats.html"
)

Write-Host "=== Synchronisation LINK CI ===" -ForegroundColor Yellow

function Upload-File($local, $remote) {
    $content = [System.IO.File]::ReadAllText($local)
    $body = @{ content = $content }
    try {
        Invoke-RestMethod -Uri $remote -Method Post -Headers @{Authorization="Token $token"} -Body $body -ContentType "application/x-www-form-urlencoded" -ErrorAction Stop | Out-Null
        Write-Host "  OK  $($local -replace [regex]::Escape($PROJECT), '')" -ForegroundColor Green
    } catch {
        Write-Host "  ERR $($local -replace [regex]::Escape($PROJECT), '') : $_" -ForegroundColor Red
    }
}

foreach ($f in $FILES) {
    $local = Join-Path $PROJECT ($f -replace '/', '\')
    if (Test-Path $local) {
        $remote = "$base/$f"
        Upload-File $local $remote
    }
}

foreach ($tpl in $TEMPLATES) {
    $local = Join-Path $PROJECT "templates\$tpl"
    if (Test-Path $local) {
        $remote = "$base/templates/$tpl"
        Upload-File $local $remote
    }
}

Write-Host "`nRechargement..." -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "https://www.pythonanywhere.com/api/v0/user/$user/webapps/${user}.pythonanywhere.com/reload/" -Method Post -Headers @{Authorization="Token $token"} -ErrorAction Stop | Out-Null
    Write-Host "  App rechargee !" -ForegroundColor Green
} catch {
    Write-Host "  ERREUR : $_" -ForegroundColor Red
}

Write-Host "`nTermine ! https://${user}.pythonanywhere.com" -ForegroundColor Cyan
