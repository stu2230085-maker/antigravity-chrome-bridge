$tweetText = "CSS Gridのgrid-template-areasを初めて使った日、floatとclearfixで3時間格闘してた過去の自分を本気で叱りたくなった。`nレイアウトに名前つけるだけで配置できるの、もっと早く教えてくれよ…`n`n#Web開発 #CSS #エンジニアあるある"

$jsCode = @"
const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
if (!editor) return 'editor not found';
editor.focus();
const dataTransfer = new DataTransfer();
dataTransfer.setData('text/plain', '$($tweetText -replace "'","\'")');
const pasteEvent = new ClipboardEvent('paste', {
  clipboardData: dataTransfer,
  bubbles: true,
  cancelable: true
});
editor.dispatchEvent(pasteEvent);
return 'pasted';
"@

$body = @{
    action = "evaluate"
    params = @{ code = $jsCode }
} | ConvertTo-Json -Depth 3

$response = Invoke-WebRequest -Uri "http://localhost:8766/command" -Method POST -ContentType "application/json" -Body $body
Write-Host $response.Content
