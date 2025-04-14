// ─── グローバル変数 ─────────────────────────────
let allWords = [];
let activeWords = [];
let currentIndex = 0;
let resultsData = {};  // DBから取得した結果；キーは "number" をハイフンで連結
let promptThreshold = 0;  // 継続プロンプトの閾値（初期は0, 100,200,300,…）
let isComposing = false;  // IME変換中フラグ
let currentAnswerCorrect = null;  // 最後の回答の正誤（true/false/null）

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

// ─── 今日の正答（correct）数更新関数 ─────────────────────────────
function updateTodayCorrectCount() {
  let count = 0;
  Object.values(resultsData).forEach(record => {
    if (record.last_correct && isToday(record.last_correct)) {
      count++;
    }
  });
  console.log("【DEBUG】今日の正答数:", count);
  return count;
}

// ─── 継続プロンプト表示用関数 ─────────────────────────────
function showContinuePrompt(todayCount) {
  const continueContainer = document.getElementById('continue-container');
  const messageEl = document.querySelector('.continue-message');
  messageEl.textContent = `${todayCount}個の例文に正答しました。学習を継続しますか？`;
  console.log("【DEBUG】継続プロンプト表示：todayCount =", todayCount);
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
  // DB上で今日正答済み（last_correct更新済み）の単語を除外して activeWords 生成
  activeWords = allWords.filter(word => {
    const rec = resultsData[keyForWord(word)];
    return !(rec && rec.last_correct && isToday(rec.last_correct));
  });
  console.log("【DEBUG】初期 activeWords 数:", activeWords.length);
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

// 【変更】：chooseNextWord() で currentIndex の範囲外を防止
function chooseNextWord() {
  if (activeWords.length < 1) return;
  currentIndex = chooseWeightedIndex();
  if (currentIndex >= activeWords.length) { // ガードチェック
    console.warn("【DEBUG】currentIndexが範囲外です。リセットします。");
    currentIndex = 0;
  }
  console.log("【DEBUG】次の問題インデックス:", currentIndex);
}

// ─── displayWord() の最適化 ─────────────────────────────
// 【変更】：activeWords[currentIndex]がundefinedの場合のガード処理を追加
function displayWord() {
  if (activeWords.length < 1) {
    document.getElementById('training-container').classList.add('hidden');
    document.getElementById('reset-container').classList.add('visible');
    return;
  }
  const currentWord = activeWords[currentIndex];
  if (!currentWord) {
    console.error("【DEBUG】currentWordがundefined。activeWords:", activeWords);
    currentIndex = 0;
    displayWord();
    return;
  }
  // 聞き取りトレーニングでは例文は画面上に表示せず、右下に単語番号のみ表示
  document.getElementById('word-number').textContent = `#${keyForWord(currentWord)}`;
  
  const answerInput = document.getElementById('answer-input');
  answerInput.value = "";
  answerInput.focus();  // 自動フォーカス
  
  document.getElementById('overlay').classList.remove('visible');
  
  // 新問題の例文音声再生
  const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
  playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
  
  console.log("【DEBUG】displayWord() 実行：問題=", keyForWord(currentWord));
}

// ─── 正規化関数 ─────────────────────────────
function normalizeText(text) {
  const removeChars = /[，。？、「」]/g;
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
// 【変更】：オーバーレイ表示中なら Enter キーでオーバーレイ解除し、正解なら単語を activeWords から削除して次の問題へ進む
document.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    if ((e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") && window.isComposing) {
      return;
    }
    if (document.getElementById('overlay').classList.contains('visible')) {
      document.getElementById('overlay').classList.remove('visible');
      console.log("【DEBUG】Enter：オーバーレイ解除");
      if (currentAnswerCorrect === true) {
        console.log("【DEBUG】正答だったので、単語", keyForWord(activeWords[currentIndex]), "を除外");
        activeWords.splice(currentIndex, 1);
      }
      chooseNextWord();
      displayWord();
      return;
    }
    const answerInput = document.getElementById('answer-input');
    if (answerInput.value.trim() !== "") {
      processAnswer();
    } else {
      processAnswer(true);  // 空入力＝不正解
    }
  }
});

// ─── グローバルSpaceキーイベント ─────────────────────────────
// 【変更】：IME変換中でなければ、スペースキーで例文再生
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
  chooseNextWord();
  displayWord();
});

// ─── リセットボタン ─────────────────────────────
document.getElementById('resetBtn').addEventListener('click', function(e) {
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
  const currentWord = activeWords[currentIndex];
  const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
  playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
});

// ─── 回答処理（正誤判定） ─────────────────────────────
// 【変更】：空入力の場合は不正解扱い；activeWordsからの除外はEnterキーイベント側で実施
function processAnswer(emptyInput = false) {
  const answerInput = document.getElementById('answer-input');
  const userAnswer = emptyInput ? "" : normalizeText(answerInput.value);
  const currentWord = activeWords[currentIndex];
  const correctAnswer = normalizeText(currentWord.example.text);
  
  const isCorrect = emptyInput ? false : (userAnswer === correctAnswer);
  currentAnswerCorrect = isCorrect;
  console.log("【DEBUG】processAnswer: userAnswer =", userAnswer, "正解 =", correctAnswer, "結果 =", isCorrect);
  
  const shadowingMode = document.getElementById('shadowing-checkbox').checked;
  
  if (!shadowingMode) {
    if (isCorrect) {
      playFeedbackSound('correct');
    } else {
      playFeedbackSound('incorrect');
    }
  }
  
  // オーバーレイ表示（回答結果確認）：例文は既に表示済みのものを使う
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
  console.log("【DEBUG】オーバーレイ表示：正誤 =", isCorrect);
}

// ─── 回答送信処理 ─────────────────────────────
// "correct"の場合にのみlast_correctを更新
function recordAnswer(result) {
  const currentWord = activeWords[currentIndex];
  fetch('/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: currentWord.number, result: result })
  }).then(response => response.json())
    .then(data => {
      console.log(`【DEBUG】Word: ${keyForWord(currentWord)}, Result: ${result}, Accuracy: ${data.accuracy}`);
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
