$ErrorActionPreference = 'Stop'

# Non-UTF-8 consoles corrupt every Thai/emoji literal in the uploaded bundle
# (each non-ASCII char ships as '?') while local files and git stay clean.
# Force UTF-8 before any supabase CLI call and verify the bundle afterwards.
chcp 65001 | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Read-DotEnv($path) {
  $vars = @{}

  if (-not (Test-Path $path)) {
    return $vars
  }

  Get-Content $path | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $vars[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
    }
  }

  return $vars
}

$envLocal = Read-DotEnv '.env.local'

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN) -and -not [string]::IsNullOrWhiteSpace($envLocal['SUPABASE_ACCESS_TOKEN'])) {
  $env:SUPABASE_ACCESS_TOKEN = $envLocal['SUPABASE_ACCESS_TOKEN']
}

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN)) {
  throw 'Missing SUPABASE_ACCESS_TOKEN. Create one at https://supabase.com/dashboard/account/tokens and set it as an environment variable or in .env.local.'
}

$supabaseUrl = $envLocal['EXPO_PUBLIC_SUPABASE_URL']

if ([string]::IsNullOrWhiteSpace($supabaseUrl)) {
  throw 'Missing EXPO_PUBLIC_SUPABASE_URL in .env.local.'
}

$projectRef = ([Uri]$supabaseUrl).Host.Split('.')[0]

Write-Output "Deploying MiraCare v2 edge functions to Supabase project $projectRef"
npx supabase functions deploy chat-orchestrator --project-ref $projectRef
npx supabase functions deploy fact-extractor --project-ref $projectRef
npx supabase functions deploy admin-order-action --project-ref $projectRef
npx supabase functions deploy referrer-order --project-ref $projectRef
npx supabase functions deploy line-webhook --project-ref $projectRef --no-verify-jwt
npx supabase functions deploy stripe-checkout --project-ref $projectRef
npx supabase functions deploy stripe-webhook --project-ref $projectRef --no-verify-jwt
npx supabase functions deploy lab-ingest --project-ref $projectRef
npx supabase functions deploy lab-confirm --project-ref $projectRef
npx supabase functions deploy wearable-ingest --project-ref $projectRef
npx supabase functions deploy pdpa-export --project-ref $projectRef
npx supabase functions deploy pdpa-delete --project-ref $projectRef

Write-Output 'Verifying deployed bundle encoding (chat-orchestrator canary)...'
$verifyDir = Join-Path ([IO.Path]::GetTempPath()) ("mira-deploy-verify-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $verifyDir | Out-Null
Push-Location $verifyDir
try {
  npx supabase functions download chat-orchestrator --project-ref $projectRef | Out-Null
  $canary = Get-ChildItem -Recurse $verifyDir -Filter 'orchestrate.ts' | Select-Object -First 1

  if (-not $canary) {
    throw 'Bundle verification failed: downloaded source not found.'
  }

  $content = [System.Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($canary.FullName))

  if ([regex]::IsMatch($content, '\?{3,}')) {
    throw 'Bundle verification FAILED: deployed source contains mojibake (runs of "?"). Redeploy from a UTF-8 console.'
  }

  Write-Output 'Bundle verification passed: no mojibake in deployed source.'
} finally {
  Pop-Location
  Remove-Item -Recurse -Force $verifyDir -ErrorAction SilentlyContinue
}
