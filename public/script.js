// ─── グローバル変数 ─────────────────────────────
let allWords = [];
let activeWords = [];
let currentIndex = 0;
let resultsData = {};  // DBから取得した結果データ；キーは "number" をハイフンで連結
let promptThreshold = 0;  // 継続プロンプト閾値（初期は0、100,200,300,…）

// ─── 複合キー作成関数 ─────────────────────────────
function keyForWord(word) {
  if (!Array.isArray(word.number)) {
    console.error("デバッグ：word.number が配列ではありません。word:", word);
    throw new Error("word.number is not an array. Please check words.json data format.");
  }
  return word.number.join('-');
}

// ─── 今日の日付判定 ─────────────────────────────
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
  // トレーニングコンテナを隠し、継続プロンプトを表示
  document.getElementById('training-container').classList.add('hidden');
  continueContainer.classList.add('visible');
}

// ─── 初期データ読み込み ─────────────────────────────
Promise.all([
  fetch('words.json').then(r => r.json()),
  fetch('/results').then(r => r.json())
]).then(([wordsData, resData]) => {
  allWords = wordsData;
  resData.forEach(record => {
    const key = record.number.join('-');
    resultsData[key] = record;
  });
  // activeWords 作成：DB上で今日正答済みの単語は除外
  activeWords = allWords.filter(word => {
    const rec = resultsData[keyForWord(word)];
    if (rec && rec.last_correct && isToday(rec.last_correct)) {
      return false;
    }
    return true;
  });
  if (activeWords.length < 1) {
    document.getElementById('training-container').classList.add('hidden');
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
    document.getElementById('training-container').classList.add('hidden');
    document.getElementById('reset-container').classList.add('visible');
    return;
  }
  const currentWord = activeWords[currentIndex];
  // 聞き取りトレーニングなので、画面上には例文は表示せず、右下に単語番号を表示
  document.getElementById('card-word').textContent = "";
  document.getElementById('word-number').textContent = `#${keyForWord(currentWord)}`;
  // 入力欄をクリア
  document.getElementById('answer-input').value = "";
  // オーバーレイは非表示
  document.getElementById('overlay').classList.remove('visible');
  // 自動で例文音声を再生
  const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
  playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
}

// ─── 正規化関数 ─────────────────────────────
function normalizeText(text) {
  const removeChars = /[，。？、]/g;
  const mapping = { "她": "他", "妳": "你" };
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
  const shadowingMode = document.getElementById('shadowing-checkbox').checked;
  if (shadowingMode) return;
  const soundUrl = `sounds/${type}.mp3`;
  const audio = new Audio(soundUrl);
  audio.play().catch(err => console.error(err));
}

// ─── イベントリスナー ─────────────────────────────
// 変更点：オーバーレイ自体にもクリックとエンターキーで次の問題へ進む動作を追加
const overlayEl = document.getElementById('overlay');
overlayEl.addEventListener('click', function(e) {
  // オーバーレイクリック時に次の問題へ進む
  overlayEl.classList.remove('visible');
  chooseNextWord();
  displayWord();
});
overlayEl.addEventListener('keypress', function(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    overlayEl.classList.remove('visible');
    chooseNextWord();
    displayWord();
  }
});

// トレーニングコンテナクリック：回答入力がある場合は回答確定
document.getElementById('training-container').addEventListener('click', function(e) {
  // 入力欄の状態確認
  const answerInput = document.getElementById('answer-input');
  if (answerInput.value.trim() !== "") {
    processAnswer();
  }
});

// 入力欄エンターキーで回答確定
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
  document.getElementById('training-container').classList.remove('hidden');
  displayWord();
});

// リセットボタン
document.getElementById('resetBtn').addEventListener('click', function(e) {
  activeWords = allWords.slice();
  chooseNextWord();
  document.getElementById('reset-container').classList.remove('visible');
  document.getElementById('training-container').classList.remove('hidden');
  displayWord();
});

// 例文再生ボタン（聞き取りモード用）
document.getElementById('replayPhraseBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  const currentWord = activeWords[currentIndex];
  const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
  playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
});

// オーバーレイ内の例文再生ボタン
document.getElementById('replayResultBtn').addEventListener('click', function(e) {
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
  
  // オーバーレイ表示（回答結果確認）
  showResultOverlay(isCorrect, currentWord);
  
  // 結果記録（シャドーイングモードでなければ）
  if (!shadowingMode) {
    if (isCorrect) {
      recordAnswer("correct");
    } else {
      recordAnswer("incorrect");
    }
  }
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
      if (!resultsData[keyForWord(currentWord)]) {
        resultsData[keyForWord(currentWord)] = { history: [] };
      }
      if (result === "correct") {
        resultsData[keyForWord(currentWord)].last_correct = new Date().toISOString();
      }
      const todayCount = updateTodayCorrectCount();
      if (todayCount >= promptThreshold + 100) {
        promptThreshold = Math.floor(todayCount / 100) * 100;
        showContinuePrompt(todayCount);
        return;
      }
    });
}
