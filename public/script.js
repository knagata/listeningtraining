// ─── グローバル変数 ───────────────────────────────
let allWords = [];
let activeWords = [];
let currentIndex = 0;
let resultsData = {}; // DBから取得した結果データ；キーは "number" をハイフンで連結した文字列
let promptThreshold = 0; // 継続プロンプト閾値（初期値：0，100, 200, ...）

// ─── 複合キー作成関数 ───────────────────────────────
function keyForWord(word) {
  if (!Array.isArray(word.number)) {
    console.error("デバッグ：word.number が配列ではありません。word:", word);
    throw new Error("word.number is not an array. Please check words.json data format.");
  }
  return word.number.join('-');
}

// ─── 今日の日付判定 ───────────────────────────────
function isToday(dateString) {
  const d = new Date(dateString);
  const today = new Date();
  return d.getFullYear() === today.getFullYear() &&
         d.getMonth() === today.getMonth() &&
         d.getDate() === today.getDate();
}

// ─── 今日の正答（correct）タップ数更新関数 ─────────────
function updateTodayCorrectCount() {
  let count = 0;
  Object.values(resultsData).forEach(record => {
    // ここでは last_correct をチェック
    if (record.last_correct && isToday(record.last_correct)) {
      count++;
    }
  });
  console.log("今日の正答タップ数:", count);
  return count;
}

// ─── 継続プロンプト表示用関数 ─────────────
function showContinuePrompt(todayCount) {
  const continueContainer = document.getElementById('continue-container');
  const messageEl = document.querySelector('.continue-message');
  messageEl.textContent = `${todayCount}個の例文に正答しました。学習を継続しますか？`;
  // フラッシュカードエリアを隠して、継続プロンプトを表示
  document.getElementById('card-container').classList.add('hidden');
  continueContainer.classList.add('visible');
}

// ─── 初期データ読み込み ─────────────────────────────
Promise.all([
  fetch('words.json').then(r => r.json()),
  fetch('/results').then(r => r.json())
]).then(([wordsData, resData]) => {
  allWords = wordsData;
  // resData をキー付きオブジェクトに変換（キーは number 配列をハイフン連結）
  resData.forEach(record => {
    const key = record.number.join('-');
    resultsData[key] = record;
  });
  // activeWords の生成：DB上で今日正答済みの単語は除外する
  activeWords = allWords.filter(word => {
    const rec = resultsData[keyForWord(word)];
    if (rec && rec.last_correct && isToday(rec.last_correct)) {
      return false;
    }
    return true;
  });
  // 初期化時に activeWords が空ならリセット画面表示
  if (activeWords.length < 1) {
    document.getElementById('card-container').classList.add('hidden');
    document.getElementById('reset-container').classList.add('visible');
  } else {
    chooseNextWord();
    displayWord();
  }
});

// ─── 重み付きランダム選出 ─────────────────────────────
function chooseWeightedIndex() {
  let totalWeight = 0;
  let weights = [];
  activeWords.forEach(word => {
    const rec = resultsData[keyForWord(word)];
    let accuracy = 0;
    if (rec && rec.history && rec.history.length > 0) {
      const total = rec.history.length;
      const sum = rec.history.reduce((a, b) => a + b, 0);
      accuracy = Math.round((sum / total) * 100);
    }
    const weight = (100 - accuracy) + 1;
    weights.push(weight);
    totalWeight += weight;
  });
  let rnd = Math.random() * totalWeight;
  let cumulative = 0;
  for (let i = 0; i < activeWords.length; i++) {
    cumulative += weights[i];
    if (rnd < cumulative) return i;
  }
  return activeWords.length - 1;
}

function chooseNextWord() {
  if (activeWords.length < 1) return;
  currentIndex = chooseWeightedIndex();
}

function displayWord() {
  if (activeWords.length < 1) {
    document.getElementById('card-container').classList.add('hidden');
    document.getElementById('reset-container').classList.add('visible');
    return;
  }
  const currentWord = activeWords[currentIndex];
  document.getElementById('card-word').textContent = currentWord.word;
  document.getElementById('word-number').textContent = `#${keyForWord(currentWord)}`;
  
  // 聞き取りモード：テキスト入力欄を空にする
  document.getElementById('answer-input').value = "";
  // オーバーレイは非表示
  document.getElementById('overlay').classList.remove('visible');
  
  // 自動で例文の音声再生
  const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
  playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
}

// ─── 正規化関数 ─────────────────────────────
function normalizeText(text) {
  // 例：不要な記号を削除＆同音文字の統一変換（必要に応じて調整）
  const removeChars = /[，。？、]/g;
  const mapping = {
    "她": "他",
    "妳": "你"
  };
  let normalized = text.replace(removeChars, "");
  normalized = normalized.split("").map(ch => mapping[ch] || ch).join("");
  normalized = normalized.replace(/\s+/g, "");
  return normalized;
}

// ─── 音声・サウンド再生関連 ─────────────────────────────
function speakText(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-TW';
  speechSynthesis.speak(utterance);
}

function playAudioWithFallback(url, fallbackFn) {
  const audio = new Audio(url);
  audio.onerror = fallbackFn;
  audio.oncanplaythrough = () => audio.play();
  audio.load();
}

function playFeedbackSound(type) {
  // チェックボックス（シャドーイングモード）確認
  const shadowingMode = document.getElementById('shadowing-checkbox').checked;
  if (shadowingMode) return;
  const soundUrl = `sounds/${type}.mp3`;
  const audio = new Audio(soundUrl);
  audio.play().catch(err => console.error(err));
}

// ─── イベントリスナー ─────────────────────────────

// カードコンテナクリック：聞き取りモード
document.getElementById('card-container').addEventListener('click', function(e) {
  // もしオーバーレイが表示中（回答確認中）またはシャドーイングモードなら何もしない
  const overlay = document.getElementById('overlay');
  const shadowingMode = document.getElementById('shadowing-checkbox').checked;
  if (overlay.classList.contains('visible') || shadowingMode) return;
  
  // もし回答入力欄に内容があれば回答確定
  const answerInput = document.getElementById('answer-input');
  if (answerInput.value.trim() !== "") {
    processAnswer();
  }
});

// エンターキー押下で回答確定
document.getElementById('answer-input').addEventListener('keypress', function(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    processAnswer();
  }
});

// 継続プロンプト「継続する」ボタン
document.getElementById('continueBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('continue-container').classList.remove('visible');
  document.getElementById('card-container').classList.remove('hidden');
  displayWord();
});

// リセットボタン
document.getElementById('resetBtn').addEventListener('click', function(e) {
  // フロントエンド側リセット：activeWords を全単語に戻す
  activeWords = allWords.slice();
  chooseNextWord();
  document.getElementById('reset-container').classList.remove('visible');
  document.getElementById('card-container').classList.remove('hidden');
  displayWord();
});

// 単語再生ボタン
document.getElementById('replayBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  const currentWord = activeWords[currentIndex];
  // ここでは例文再生の再生ボタンとして使用
  const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
  playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
});

// 例文再生ボタン
document.getElementById('phraseReplayBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  const currentWord = activeWords[currentIndex];
  const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
  playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
});

// ─── 回答処理（正誤判定） ─────────────────────────────
function processAnswer() {
  const answerInput = document.getElementById('answer-input');
  const userAnswer = normalizeText(answerInput.value);
  const currentWord = activeWords[currentIndex];
  const correctAnswer = normalizeText(currentWord.example.text);
  
  const isCorrect = (userAnswer === correctAnswer);
  const shadowingMode = document.getElementById('shadowing-checkbox').checked;
  
  if (!shadowingMode) {
    if (isCorrect) {
      playFeedbackSound('correct');
    } else {
      playFeedbackSound('incorrect');
    }
  }
  
  // オーバーレイ表示で正解例文等を確認できるようにする
  showResultOverlay(isCorrect, currentWord);
  
  // 結果を記録（シャドーイングモードでなければ）
  if (!shadowingMode) {
    if (isCorrect) {
      recordAnswer("correct");
    } else {
      recordAnswer("incorrect");
    }
  }
}

// オーバーレイ表示：回答確認
function showResultOverlay(isCorrect, word) {
  const overlay = document.getElementById('overlay');
  document.getElementById('pinyin').textContent = word.example.pinyin;
  document.getElementById('meaning').textContent = word.example.translation;
  document.getElementById('example').innerHTML = `<strong>例文:</strong> ${word.example.text}`;
  overlay.classList.add('visible');
}

// ─── 回答送信処理 ─────────────────────────────
function recordAnswer(result) {
  const currentWord = activeWords[currentIndex];
  fetch('/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: currentWord.number, result: result })
  }).then(response => response.json())
    .then(data => {
      console.log(`Word: ${keyForWord(currentWord)}, Result: ${result}, Accuracy: ${data.accuracy}`);
      // ローカルresultsData更新：正答の場合はlast_correctを更新する
      if (!resultsData[keyForWord(currentWord)]) {
        resultsData[keyForWord(currentWord)] = { history: [] };
      }
      if (result === "correct") {
        resultsData[keyForWord(currentWord)].last_correct = new Date().toISOString();
      }
      // 更新後、正答タップ数を再計算
      const todayCount = updateTodayCorrectCount();
      if (todayCount >= promptThreshold + 100) {
        promptThreshold = Math.floor(todayCount / 100) * 100;
        showContinuePrompt(todayCount);
        return;
      }
    });
}

// ─── 正誤ボタンイベント ─────────────────────────────
// ここでは SuperCorrect ボタンは廃止し、正答(◯)と誤答(✗)のみ

document.getElementById('correctBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  playFeedbackSound('correct');
  recordAnswer("correct");
  chooseNextWord();
  displayWord();
});

document.getElementById('incorrectBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  playFeedbackSound('incorrect');
  recordAnswer("incorrect");
  chooseNextWord();
  displayWord();
});
