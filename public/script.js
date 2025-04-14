// ─── グローバル変数 ─────────────────────────────
let allWords = [];
let activeWords = [];
let currentIndex = 0;
let resultsData = {}; // DBから取得した結果データ；キーは "number" をハイフンで連結
let promptThreshold = 0; // 継続プロンプトの閾値（初期は0，100,200,300,…）
let isComposing = false; // IME変換中かどうかのフラグ

// ─── 複合キー作成関数 ─────────────────────────────
// word.numberが配列であることを前提。そうでなければエラーをスロー
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
// resultsDataの各レコードでlast_correctが今日ならカウント
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
// 今日の正答数が (promptThreshold + 100) に達した場合に実行
function showContinuePrompt(todayCount) {
  const continueContainer = document.getElementById('continue-container');
  const messageEl = document.querySelector('.continue-message');
  messageEl.textContent = `${todayCount}個の例文に正答しました。学習を継続しますか？`;
  // トレーニングコンテナを隠して、継続プロンプトを表示
  document.getElementById('training-container').classList.add('hidden');
  continueContainer.classList.add('visible');
}

// ─── 初期データ読み込み ─────────────────────────────
// words.jsonと/resultsからデータを取得し、activeWordsを生成
Promise.all([
  fetch('words.json').then(r => r.json()),
  fetch('/results').then(r => r.json())
]).then(([wordsData, resData]) => {
  allWords = wordsData;
  resData.forEach(record => {
    const key = record.number.join('-');
    resultsData[key] = record;
  });
  // activeWords生成：DB上で今日正答済み（last_correct更新済み）の単語は除外
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
    // 正答率が低い単語ほど重みが大きくなる
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

// ─── displayWord() の最適化 ─────────────────────────────
// 変更点：次の問題表示時にanswer-inputへ自動focusを追加
function displayWord() {
  if (activeWords.length < 1) {
    document.getElementById('training-container').classList.add('hidden');
    document.getElementById('reset-container').classList.add('visible');
    return;
  }
  const currentWord = activeWords[currentIndex];
  // 聞き取りトレーニングでは、画面上に例文は表示しないので、単語番号のみ表示（flashcard版から変更）
  document.getElementById('word-number').textContent = `#${keyForWord(currentWord)}`;
  
  // 回答入力欄をクリアし、自動でフォーカスを当てる（変更）
  const answerInput = document.getElementById('answer-input');
  answerInput.value = "";
  answerInput.focus();
  
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
  // シャドーイングモードチェック
  const shadowingMode = document.getElementById('shadowing-checkbox').checked;
  if (shadowingMode) return;
  const soundUrl = `sounds/${type}.mp3`;
  const audio = new Audio(soundUrl);
  audio.play().catch(err => console.error(err));
}

// ─── IME変換中を判定するためのイベントリスナー ─────────────────────────────
const answerInputEl = document.getElementById('answer-input');
answerInputEl.addEventListener('compositionstart', function() {
  window.isComposing = true;  // グローバル変数として管理
});
answerInputEl.addEventListener('compositionend', function() {
  window.isComposing = false;
});

// ─── グローバルEnterキーイベント ─────────────────────────────
// 変更点：IME変換中ではない場合、Enterキーを押すと次の問題へ進む
document.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    // もし入力欄でIME変換中なら何もしない
    if ((e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") && window.isComposing) {
      return;
    }
    // もしオーバーレイが表示中なら、Enterでオーバーレイを解除して次の問題へ
    if (document.getElementById('overlay').classList.contains('visible')) {
      document.getElementById('overlay').classList.remove('visible');
      chooseNextWord();
      displayWord();
      return;
    }
    // それ以外の場合、入力欄にテキストがあれば回答処理、なければ次の問題へ
    if (answerInputEl.value.trim() !== "") {
      processAnswer();
    } else {
      chooseNextWord();
      displayWord();
    }
  }
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
  
  // オーバーレイ表示で回答結果を確認
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

// ─── オーバーレイ表示（回答結果確認） ─────────────────────────────
function showResultOverlay(isCorrect, word) {
  document.querySelector('#correct-example span').textContent = word.example.text;
  document.querySelector('#result-pinyin span').textContent = word.example.pinyin;
  document.querySelector('#result-translation span').textContent = word.example.translation;
  document.getElementById('overlay').classList.add('visible');
}

// ─── 回答送信処理 ─────────────────────────────
// 今回は "correct" と "incorrect" のみ送信する
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

// ─── 継続プロンプト「継続する」ボタン ─────────────────────────────
document.getElementById('continueBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('continue-container').classList.remove('visible');
  document.getElementById('training-container').classList.remove('hidden');
  displayWord();
});

// ─── リセットボタン ─────────────────────────────
document.getElementById('resetBtn').addEventListener('click', function(e) {
  activeWords = allWords.slice();
  chooseNextWord();
  document.getElementById('reset-container').classList.remove('visible');
  document.getElementById('training-container').classList.remove('hidden');
  displayWord();
});

// ─── 例文再生ボタン（聞き取りモード用） ─────────────────────────────
document.getElementById('replayPhraseBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  const currentWord = activeWords[currentIndex];
  const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
  playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
});

// ─── オーバーレイ内の例文再生ボタン ─────────────────────────────
document.getElementById('replayResultBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  const currentWord = activeWords[currentIndex];
  const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
  playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
});
