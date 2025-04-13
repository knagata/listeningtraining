// ─── グローバル変数 ───────────────────────────────
let allWords = [];
let activeWords = [];
let currentIndex = 0;
let resultsData = {}; // DBから取得した結果データ；キーは "number" をハイフン連結した文字列
let promptThreshold = 0; // 継続プロンプトの閾値（初期は 0，100, 200, 300, …）

// ─── 複合キー作成関数 ───────────────────────────────
// word.number が配列である前提；そうでなければエラーをスロー
function keyForWord(word) {
  if (!Array.isArray(word.number)) {
    console.error("デバッグ：word.number が配列ではありません。word:", word);
    throw new Error("word.number is not an array. Please check words.json data format.");
  }
  return word.number.join('-');
}

// ─── 今日の日付判定 ───────────────────────────────
// ISO文字列の日付部分が今日かどうか判定
function isToday(dateString) {
  const d = new Date(dateString);
  const today = new Date();
  return d.getFullYear() === today.getFullYear() &&
         d.getMonth() === today.getMonth() &&
         d.getDate() === today.getDate();
}

// ─── 今日の SuperCorrect タップ数更新関数 ─────────────
// resultsData 内の各レコードで last_super_correct が今日ならカウント
function updateTodaySuperCorrectCount() {
  let count = 0;
  Object.values(resultsData).forEach(record => {
    if (record.last_super_correct && isToday(record.last_super_correct)) {
      count++;
    }
  });
  return count;
}

// ─── 継続プロンプト表示用関数 ─────────────
// 今日の SuperCorrect タップ数が (promptThreshold + 100) に達した場合に表示
function showContinuePrompt(todayCount) {
  const continueContainer = document.getElementById('continue-container');
  const messageEl = document.querySelector('.continue-message');
  messageEl.textContent = `${todayCount}個の例文に正答しました。学習を継続しますか？`;
  // フラッシュカード(聞き取りモード)エリアを隠し、継続プロンプトを表示
  document.getElementById('card-container').classList.add('hidden');
  continueContainer.classList.add('visible');
}

// ─── 初期データ読み込み ─────────────────────────────
// words.json と /results からデータを取得し、activeWords を生成
Promise.all([
  fetch('words.json').then(r => r.json()),
  fetch('/results').then(r => r.json())
]).then(([wordsData, resData]) => {
  allWords = wordsData;
  // resData は配列なので、キー付きオブジェクトに変換（キーは number 配列をハイフン連結）
  resData.forEach(record => {
    const key = record.number.join('-');
    resultsData[key] = record;
  });
  // フィルタリング：DB上で今日正答済みの単語は activeWords から除外
  activeWords = allWords.filter(word => {
    const rec = resultsData[keyForWord(word)];
    if (rec && rec.last_super_correct && isToday(rec.last_super_correct)) {
      return false;
    }
    return true;
  });
  
  // 初期化時、activeWords が空ならリセット画面を表示
  if (activeWords.length < 1) {
    document.getElementById('card-container').classList.add('hidden');
    document.getElementById('reset-container').classList.add('visible');
  } else {
    chooseNextWord();
    displayWord();
  }
});

// ─── 重み付きランダム選出 ─────────────────────────────
// 各単語の重み = (100 - accuracy) + 1 （未記録なら accuracy＝0）
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
  // 表示される番号は例として、単語識別用の複合キー
  document.getElementById('card-word').textContent = currentWord.word;
  document.getElementById('word-number').textContent = `#${keyForWord(currentWord)}`;
  
  // 聞き取りモード用の入力欄は空にする
  document.getElementById('answer-input').value = "";
  
  // オーバーレイは非表示にする
  document.getElementById('overlay').classList.remove('visible');
  
  // 自動で例文の音声再生（listen mode）
  const phraseAudioUrl = `mp3/${keyForWord(currentWord)}_phrase.mp3`;
  playAudioWithFallback(phraseAudioUrl, () => speakText(currentWord.example.text));
}

// ─── 正規化関数 ─────────────────────────────
// 指定の記号を削除、または同音の文字に統一する関数
function normalizeText(text) {
  // 例：句読点を削除（，。？）および変換対象ペアを統一
  const removeChars = /[，。？、]/g;
  const mapping = {
    "她": "他", // 例：彼女と彼を同一視（必要に応じて調整）
    "妳": "你"  // 例：妳と你を同一視
  };
  let normalized = text.replace(removeChars, "");
  normalized = normalized.split("").map(ch => mapping[ch] || ch).join("");
  // 空白も除去して比較
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
  // チェックボックス（シャドーイングモード）がオンの場合は、サウンド再生せず、結果も記録しない
  const shadowingMode = document.getElementById('shadowing-checkbox').checked;
  if (shadowingMode) return;
  const soundUrl = `sounds/${type}.mp3`;
  const audio = new Audio(soundUrl);
  audio.play().catch(err => console.error(err));
}

// ─── イベントリスナー ─────────────────────────────
// カードコンテナ（聞き取りモード）クリック時：フォーカスを外して回答確定
document.getElementById('card-container').addEventListener('click', function(e) {
  // もしオーバーレイが表示中（回答確認中）またはシャドーイングモード中なら無視
  const overlay = document.getElementById('overlay');
  const shadowingMode = document.getElementById('shadowing-checkbox').checked;
  if (overlay.classList.contains('visible') || shadowingMode) return;
  
  // ユーザーが入力している場合、回答確定として処理（Enterキーでも処理する）
  const answerInput = document.getElementById('answer-input');
  if (answerInput.value.trim() !== "") {
    // 回答確定処理を呼び出す
    processAnswer();
  }
  // 何も入力されていなければ、新しい問題の準備（クリックが単に音声再生トリガーの場合）
});

// エンターキーで回答確定
document.getElementById('answer-input').addEventListener('keypress', function(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    processAnswer();
  }
});

// 継続プロンプト用「継続する」ボタン
document.getElementById('continueBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('continue-container').classList.remove('visible');
  document.getElementById('card-container').classList.remove('hidden');
  displayWord();
});

// リセットボタン
document.getElementById('resetBtn').addEventListener('click', function(e) {
  // フロントエンド側リセット：activeWordsをallWordsのコピーに戻す
  activeWords = allWords.slice();
  chooseNextWord();
  document.getElementById('reset-container').classList.remove('visible');
  document.getElementById('card-container').classList.remove('hidden');
  displayWord();
});

// ─── 回答処理（正誤判定） ─────────────────────────────
function processAnswer() {
  // 入力された回答と正解例文を比較（normalizeして比較）
  const answerInput = document.getElementById('answer-input');
  const userAnswer = normalizeText(answerInput.value);
  const currentWord = activeWords[currentIndex];
  const correctAnswer = normalizeText(currentWord.example.text);
  
  // 結果判定
  const isCorrect = (userAnswer === correctAnswer);
  
  // シャドーイングモードチェック
  const shadowingMode = document.getElementById('shadowing-checkbox').checked;
  
  // 結果に応じたサウンド再生（シャドーイングモードの場合は再生せず、記録も行わない）
  if (!shadowingMode) {
    if (isCorrect) {
      playFeedbackSound('correct');
    } else {
      playFeedbackSound('incorrect');
    }
  }
  
  // 正答・誤答の判定結果をオーバーレイ表示
  showResultOverlay(isCorrect, currentWord);
  
  // recordAnswer() の呼び出しは、シャドーイングモードでなければ行う
  if (!shadowingMode) {
    if (isCorrect) {
      // 判定の仕様通り、正答の場合はrecordAnswer("correct")を呼び出し、last_super_correctは更新しない
      recordAnswer("correct");
    } else {
      recordAnswer("incorrect");
    }
  }
}

// オーバーレイ表示：正解例文等を表示する関数
function showResultOverlay(isCorrect, word) {
  const overlay = document.getElementById('overlay');
  // オーバーレイ内に正解例文、拼音、日本語訳を表示する
  document.getElementById('pinyin').textContent = word.example.pinyin;
  document.getElementById('meaning').textContent = word.example.translation;
  document.getElementById('example').innerHTML = `<strong>例文:</strong> ${word.example.text}`;
  
  // オーバーレイ表示（先に既存オーバーレイがなければ表示）
  overlay.classList.add('visible');
  
  // 右上の再生ボタンなど、既存のレイアウトと同様に、再び例文音声を聞ける
  // （再生は継続プロンプト表示後の操作で可能）
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
      // 更新後、resultsData をローカル更新（簡易的な処理）
      if (!resultsData[keyForWord(currentWord)]) {
        resultsData[keyForWord(currentWord)] = { history: [] };
      }
      if (result === "superCorrect") {
        resultsData[keyForWord(currentWord)].last_super_correct = new Date().toISOString();
      }
      // 更新後、今日のSuperCorrectカウントを再計算
      const todayCount = updateTodaySuperCorrectCount();
      // 継続プロンプトの閾値チェック
      if (todayCount >= promptThreshold + 100) {
        promptThreshold = Math.floor(todayCount / 100) * 100;
        showContinuePrompt(todayCount);
        return;  // プロンプト表示中は処理中断
      }
    });
}
  
// ─── 回答ボタンイベント（既存の正誤判定・記録処理は processAnswer() 経由で完了） ─────────────────────────────
// ただし、SuperCorrect, Correct, Incorrect のボタンは結果オーバーレイ上に表示し、
// オーバーレイ表示中はそれらのクリックで次の問題へと遷移する

document.getElementById('superCorrectBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  playFeedbackSound('superCorrect');
  // SuperCorrectの場合は activeWords から除外
  recordAnswer("superCorrect");
  activeWords.splice(currentIndex, 1);
  if (activeWords.length < 1) {
    document.getElementById('card-container').classList.add('hidden');
    document.getElementById('reset-container').classList.add('visible');
  } else {
    chooseNextWord();
    displayWord();
  }
});

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
