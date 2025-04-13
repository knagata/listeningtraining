const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function pgArray(arr) {
  return `{${arr.join(',')}}`;
}

/**
 * GET /results
 * Supabase の "results" テーブルから全レコードを取得し、返す
 */
app.get('/results', async (req, res) => {
  const { data, error } = await supabase
    .from('results')
    .select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/**
 * POST /results
 * リクエスト例: { number: [num1, num2], result: "correct" / "incorrect" }
 *
 * 【変更点】
 * ・SuperCorrectの項目は削除しました。
 * ・"correct" の場合、history に 1 を追加し、last_correct を更新する。
 * ・"incorrect" の場合は history に 0 を追加し、last_correct は更新しない。
 */
app.post('/results', async (req, res) => {
  // console.log("Received POST /results payload:", req.body);
  const { number, result } = req.body;
  // 変更：resultチェックは "correct" と "incorrect" のみ
  if (!number || !Array.isArray(number) || number.length !== 2 ||
      !["correct", "incorrect"].includes(result)) {
    return res.status(400).json({ error: "Invalid input" });
  }
  
  // 既存レコードを取得。numberフィールドは PostgreSQL の配列リテラル形式で比較
  const { data: existing, error } = await supabase
    .from('results')
    .select('*')
    .eq('number', pgArray(number))
    .single();
  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: error.message });
  }
  
  let history = [];
  let last_correct = null;
  if (existing) {
    history = existing.history || [];
  }
  if (result === "correct") {
    history.push(1);
    last_correct = new Date().toISOString(); // "correct" の場合は last_correct を更新（変更）
  } else if (result === "incorrect") {
    history.push(0);
    // "incorrect" の場合は last_correct の更新は行わない（変更）
  }
  
  if (history.length > 20) {
    history = history.slice(-20);
  }
  const total = history.length;
  const sum = history.reduce((a, b) => a + b, 0);
  const accuracy = Math.round((sum / total) * 100);
  
  // 更新データの用意："correct" なら last_correct を含む、"incorrect" なら含まない
  let updateData = { history };
  if (result === "correct") {
    updateData.last_correct = last_correct;
  }
  
  if (existing) {
    const { error: updateError } = await supabase
      .from('results')
      .update(updateData)
      .eq('number', pgArray(number));
    if (updateError) return res.status(500).json({ error: updateError.message });
  } else {
    const insertData = { number, history };
    if (result === "correct") {
      insertData.last_correct = last_correct;
    }
    const { error: insertError } = await supabase
      .from('results')
      .insert([insertData]);
    if (insertError) return res.status(500).json({ error: insertError.message });
  }
  res.json({ success: true, accuracy });
});

/**
 * POST /resetResults
 * 全レコードの last_correct を NULL に更新する
 */
app.post('/resetResults', async (req, res) => {
  const { error } = await supabase
    .from('results')
    .update({ last_correct: null });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
