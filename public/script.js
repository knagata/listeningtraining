// ─── グローバル変数 ─────────────────────────────
let allWords = [];
let activeWords = [];
let currentIndex = 0;
let resultsData = {}; // DBから取得した結果データ；キーは "number" をハイフンで連結
let promptThreshold = 0;  // 継続プロンプトの閾値（初期は0，100,200,300,…）
let isComposing = false;  // IME変換中フラグ
let currentAnswerCorrect = null;  // 今回回答した内容が正解かどうか（true/false/null）
let waitingForAnswer = false;  // 新しい問題の読み込み後、回答待ちかどうか

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
  // DB上で今日正答済み（last_correct更新済み）の単語を除外してactiveWords生成
  activeWords = allWords.filter(word => {
    const rec = resultsData[keyForWord(word)];
    return !(rec && rec.last_correct && isToday(rec.last_correct));
  });
  if (activeWords.length < 1) {
    document.getElementById('training-container').classList.add('hidden');
    document.getElementById('reset-container').classList.add('visible');
  } else {
    waitingForAnswer = true;  // 新しい問題待ちの状態
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

// ─── displayWord() の最適化 ─────────────────────────────
// 次の問題表示時に、回答入力欄をクリア・自動フォーカスし、例文音声は再生のみする
function displayWord() {
  if (activeWords.length < 1) {
    document.getElementById('training-container').classList.add('hidden');
    document.getElementById('reset-container').classList.add('visible');
    return;
  }
  const currentWord = activeWords[currentIndex];
  // 聞き取りトレーニングでは、画面上に例文は表示せず、右下に単語番号を表示
  document.getElementById('word-number').textContent = `#${keyForWord(currentWord)}`;
  
  const answerInput = document.getElementById('answer-input');
  answerInput.value = "";
  answerInput.focus();  // 自動フォーカス設定
  
  // オーバーレイは非表示
  document.getElementById('overlay').classList.remove('visible');
  
  // 新しい例文音声は、ここでのみ再生される
  if (waitingForAnswer) {
    const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
    playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
  }
  waitingForAnswer = true;  // 次の問題へ進む準備完了
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

// ─── IME変換中フラグ設定 ─────────────────────────────
const answerInputEl = document.getElementById('answer-input');
answerInputEl.addEventListener('compositionstart', () => { window.isComposing = true; });
answerInputEl.addEventListener('compositionend', () => { window.isComposing = false; });

// ─── グローバルEnterキーイベント ─────────────────────────────
// 変更：IME変換中はスキップ；オーバーレイ表示中なら何もしない；
// 入力欄にテキストがあれば processAnswer()（不正解入力の場合はemptyInputを true に）
document.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    if ((e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") && window.isComposing) {
      return;
    }
    // もしオーバーレイが表示中ならEnterキーでは何もしない（継続は「継続する」ボタンで実施）
    if (document.getElementById('overlay').classList.contains('visible')) {
      return;
    }
    const answerInput = document.getElementById('answer-input');
    if (answerInput.value.trim() !== "") {
      processAnswer();
    } else {
      processAnswer(true); // 空入力は不正解扱い
    }
  }
});

// ─── グローバルSpaceキーイベント ─────────────────────────────
// 変更：IME変換中でなければ、スペースキーで例文再生（入力欄がフォーカスされていても実行）
document.addEventListener("keydown", function(e) {
  if (e.key === " ") {
    if ((e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") && window.isComposing) {
      return;
    }
    e.preventDefault();
    const currentWord = activeWords[currentIndex];
    const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
    playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
  }
});

// ─── 継続プロンプト「継続する」ボタン ─────────────────────────────
document.getElementById('continueBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('continue-container').classList.remove('visible');
  document.getElementById('training-container').classList.remove('hidden');
  // 次の問題へ進む前に、もし前回回答が正解なら対象の単語を activeWords から削除（ユーザー選択により除外）
  if (currentAnswerCorrect === true) {
    activeWords.splice(currentIndex, 1);
  }
  // 次の問題への準備
  chooseNextWord();
  displayWord();
});

// ─── リセットボタン ─────────────────────────────
document.getElementById('resetBtn').addEventListener('click', function(e) {
  // リセット時、DB上の今日正答済み単語でフィルタリングし直す
  activeWords = allWords.filter(word => {
    const rec = resultsData[keyForWord(word)];
    return !(rec && rec.last_correct && isToday(rec.last_correct));
  });
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
  // オーバーレイ内の再生は、現在の回答対象の単語の例文を再生する（再度読み込まない）
  const currentWord = activeWords[currentIndex];
  const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
  playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
});

// ─── 回答処理（正誤判定） ─────────────────────────────
// 変更：空入力の場合は必ず不正解扱い；activeWordsから即除外せず、継続ボタンで次の問題へ進む際に削除
function processAnswer(emptyInput = false) {
  const answerInput = document.getElementById('answer-input');
  const userAnswer = emptyInput ? "" : normalizeText(answerInput.value);
  const currentWord = activeWords[currentIndex];
  const correctAnswer = normalizeText(currentWord.example.text);
  
  // 空入力なら false、それ以外は比較結果
  const isCorrect = emptyInput ? false : (userAnswer === correctAnswer);
  currentAnswerCorrect = isCorrect;  // グローバル変数に保存
  
  const shadowingMode = document.getElementById('shadowing-checkbox').checked;
  
  if (!shadowingMode) {
    if (isCorrect) {
      playFeedbackSound('correct');
    } else {
      playFeedbackSound('incorrect');
    }
  }
  
  // オーバーレイ表示で回答結果確認（表示中は新しい例文を読み込まない）
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
// 正答ならlast_correctを更新、DBへ"correct"または"incorrect"を送信
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
