'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { QUESTIONS } from '@/data/questions';

type GameState = 'home' | 'playing' | 'finished';
type ThemeMode = 'light' | 'dark';
type ShapeType = 'box' | 'circle' | 'triangle' | 'square';

export default function GamePage() {
  const [gameState, setGameState] = useState<GameState>('home');
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [userName, setUserName] = useState<string>('');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [stats, setStats] = useState<number[]>([0, 0, 0]);
  const [counts, setCounts] = useState<number[]>([0, 0, 0]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [sessionId, setSessionId] = useState<string>('');
  const [exactMatchPercentage, setExactMatchPercentage] = useState<number | null>(null);
  const [exactMatchDetails, setExactMatchDetails] = useState<{ match: number; total: number } | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [hasSavedProgress, setHasSavedProgress] = useState(false);
  const [currentShape, setCurrentShape] = useState<ShapeType>('box');

  // 自分の全回答履歴（0:左/上, 1:真ん中/中, 2:右/下）を記録
  const [myAnswerHistory, setMyAnswerHistory] = useState<number[]>([]);

  const shapes: ShapeType[] = ['box', 'circle', 'triangle', 'square'];

  // 初期化：セッションID、テーマ、名前、途中データの有無確認
  useEffect(() => {
    let id = localStorage.getItem('choice_game_session_id');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem('choice_game_session_id', id);
    }
    setSessionId(id);

    const savedTheme = (localStorage.getItem('choice_game_theme') as ThemeMode) || 'light';
    setTheme(savedTheme);

    const savedName = localStorage.getItem('choice_game_username') || '';
    setUserName(savedName);

    const savedIndex = localStorage.getItem('choice_game_current_index');
    if (savedIndex !== null) {
      const idx = parseInt(savedIndex, 10);
      if (idx > 0 && idx < QUESTIONS.length) {
        setHasSavedProgress(true);
      }
    }

    pickRandomShape();
  }, []);

  // 問題ごとに図形をランダムに選出
  const pickRandomShape = () => {
    const randomIndex = Math.floor(Math.random() * shapes.length);
    setCurrentShape(shapes[randomIndex]);
  };

  // テーマ切り替え
  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('choice_game_theme', nextTheme);
  };

  // 名前変更処理
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setUserName(name);
    localStorage.setItem('choice_game_username', name);
  };

  const currentQ = QUESTIONS[currentQuestionIndex];

  // 新しくゲームを始める
  const handleStartNew = () => {
    localStorage.removeItem('choice_game_current_index');
    setCurrentQuestionIndex(0);
    setSelectedOption(null);
    setStats([0, 0, 0]);
    setCounts([0, 0, 0]);
    setTotalCount(0);
    setExactMatchPercentage(null);
    setExactMatchDetails(null);
    setMyAnswerHistory([]);
    pickRandomShape();
    setGameState('playing');
  };

  // つづきから始める
  const handleResume = () => {
    const savedIndex = localStorage.getItem('choice_game_current_index');
    if (savedIndex !== null) {
      const idx = parseInt(savedIndex, 10);
      setCurrentQuestionIndex(idx < QUESTIONS.length ? idx : 0);
    }
    setSelectedOption(null);
    setStats([0, 0, 0]);
    setCounts([0, 0, 0]);
    setTotalCount(0);
    setMyAnswerHistory([]);
    pickRandomShape();
    setGameState('playing');
  };

  // 図形を選んだときの処理
  const handleSelect = async (optionIndex: number) => {
    if (selectedOption !== null || !sessionId || !currentQ) return;
    setSelectedOption(optionIndex);
    setLoadingStats(true);

    setMyAnswerHistory((prev) => [...prev, optionIndex]);

    try {
      // 1. Supabaseに回答とユーザーネームを保存
      await supabase.from('user_answers').insert([
        {
          session_id: sessionId,
          username: userName.trim() || '名無しさん',
          question_id: currentQ.id,
          selected_option: optionIndex,
        },
      ]);

      localStorage.setItem('choice_game_current_index', (currentQuestionIndex + 1).toString());

      // 2. 集計データの取得
      const { data, error } = await supabase
        .from('user_answers')
        .select('selected_option')
        .eq('question_id', currentQ.id);

      if (error) throw error;

      if (data && data.length > 0) {
        const rawCounts = [0, 0, 0];
        data.forEach((row) => {
          if (row.selected_option >= 0 && row.selected_option < 3) {
            rawCounts[row.selected_option]++;
          }
        });

        const total = data.length;
        const percentages = rawCounts.map((c) => (total > 0 ? Math.round((c / total) * 100) : 0));
        setCounts(rawCounts);
        setTotalCount(total);
        setStats(percentages);
      } else {
        setCounts([1, 0, 0]);
        setTotalCount(1);
        setStats([100, 0, 0]);
      }
    } catch (err) {
      console.error('データ送信エラー:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  // 次の問題へ
  const handleNext = async () => {
    const nextIndex = currentQuestionIndex + 1;
    if (nextIndex >= QUESTIONS.length) {
      setGameState('finished');
      await calculateExactMatch(sessionId);
    } else {
      setCurrentQuestionIndex(nextIndex);
      setSelectedOption(null);
      setStats([0, 0, 0]);
      setCounts([0, 0, 0]);
      setTotalCount(0);
      pickRandomShape();
    }
  };

  // 全問一致率の計算
  const calculateExactMatch = async (currentSessionId: string) => {
    try {
      const { data: myAnswers, error: myError } = await supabase
        .from('user_answers')
        .select('question_id, selected_option')
        .eq('session_id', currentSessionId)
        .order('question_id', { ascending: true });

      if (myError || !myAnswers || myAnswers.length < 20) {
        setExactMatchPercentage(0);
        setExactMatchDetails({ match: 0, total: 1 });
        return;
      }

      const { data: allAnswers, error: allError } = await supabase
        .from('user_answers')
        .select('session_id, question_id, selected_option')
        .order('question_id', { ascending: true });

      if (allError || !allAnswers) {
        setExactMatchPercentage(0);
        setExactMatchDetails({ match: 0, total: 1 });
        return;
      }

      const userMap: { [key: string]: { [qId: number]: number } } = {};
      allAnswers.forEach((row) => {
        if (!userMap[row.session_id]) {
          userMap[row.session_id] = {};
        }
        userMap[row.session_id][row.question_id] = row.selected_option;
      });

      const myMap: { [qId: number]: number } = {};
      myAnswers.forEach((row: any) => {
        myMap[row.question_id] = row.selected_option;
      });

      const totalUsers = Object.keys(userMap).length;
      if (totalUsers === 0) return;

      let matchCount = 0;
      Object.keys(userMap).forEach((uId) => {
        const uAns = userMap[uId];
        let isMatch = true;
        for (let i = 1; i <= 20; i++) {
          if (uAns[i] !== myMap[i]) {
            isMatch = false;
            break;
          }
        }
        if (isMatch) matchCount++;
      });

      const percentage = Math.round((matchCount / totalUsers) * 100);
      setExactMatchPercentage(percentage);
      setExactMatchDetails({ match: matchCount, total: totalUsers });
    } catch (err) {
      console.error('全問一致計算エラー:', err);
      setExactMatchPercentage(0);
      setExactMatchDetails({ match: 0, total: 1 });
    }
  };

  // 自分の選択傾向
  const getMyChoiceTendency = () => {
    const total = myAnswerHistory.length;
    if (total === 0) return { pos0: 0, pos1: 0, pos2: 0 };

    const c0 = myAnswerHistory.filter((a) => a === 0).length;
    const c1 = myAnswerHistory.filter((a) => a === 1).length;
    const c2 = myAnswerHistory.filter((a) => a === 2).length;

    return {
      pos0: Math.round((c0 / total) * 100),
      pos1: Math.round((c1 / total) * 100),
      pos2: Math.round((c2 / total) * 100),
    };
  };

  // SNSシェア
  const handleShare = () => {
    const displayName = userName.trim() || '名無し';
    const matchText = exactMatchDetails ? `(${exactMatchDetails.match}/${exactMatchDetails.total}人)` : '';
    const tendency = getMyChoiceTendency();
    const text = encodeURIComponent(
      `【${displayName}さんの結果】\n` +
      `20問完全一致率: ${exactMatchPercentage !== null ? exactMatchPercentage : 0}% ${matchText}\n` +
      `選択傾向: 上/左 ${tendency.pos0}% | 中/真ん中 ${tendency.pos1}% | 下/右 ${tendency.pos2}%\n` +
      `#みんなの選択`
    );
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
  };

  // 図形描画
  const ShapeRenderer = ({ type }: { type: ShapeType }) => {
    switch (type) {
      case 'circle':
        return (
          <svg viewBox="0 0 120 120" className="w-24 h-24 sm:w-28 sm:h-28 mx-auto drop-shadow-md transition-all duration-300" fill="none" stroke="currentColor" strokeWidth="3">
            <circle cx="60" cy="60" r="42" className="text-indigo-500 dark:text-indigo-400" fill="currentColor" fillOpacity={theme === 'dark' ? "0.25" : "0.1"} />
          </svg>
        );
      case 'triangle':
        return (
          <svg viewBox="0 0 120 120" className="w-24 h-24 sm:w-28 sm:h-28 mx-auto drop-shadow-md transition-all duration-300" fill="none" stroke="currentColor" strokeWidth="3">
            <polygon points="60,15 105,95 15,95" className="text-amber-500 dark:text-amber-400" fill="currentColor" fillOpacity={theme === 'dark' ? "0.25" : "0.1"} strokeLinejoin="round" />
          </svg>
        );
      case 'square':
        return (
          <svg viewBox="0 0 120 120" className="w-24 h-24 sm:w-28 sm:h-28 mx-auto drop-shadow-md transition-all duration-300" fill="none" stroke="currentColor" strokeWidth="3">
            <rect x="20" y="20" width="80" height="80" rx="12" className="text-emerald-500 dark:text-emerald-400" fill="currentColor" fillOpacity={theme === 'dark' ? "0.25" : "0.1"} strokeLinejoin="round" />
          </svg>
        );
      case 'box':
      default:
        return (
          <svg viewBox="0 0 120 120" className="w-24 h-24 sm:w-28 sm:h-28 mx-auto drop-shadow-md transition-all duration-300" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M15 40 L60 20 L105 40 L60 60 Z" className="text-sky-600 dark:text-sky-400" fill="currentColor" fillOpacity={theme === 'dark' ? "0.3" : "0.15"} strokeLinejoin="round"/>
            <path d="M22 46 L22 90 L60 108 L98 90 L98 46" className="text-sky-600 dark:text-sky-400" strokeLinejoin="round"/>
            <path d="M60 60 L60 108" className="text-sky-600 dark:text-sky-400" strokeLinecap="round"/>
          </svg>
        );
    }
  };

  const isDark = theme === 'dark';
  const tendency = getMyChoiceTendency();

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
      <div className="min-h-screen flex flex-col justify-between p-4 sm:p-6">
        
        {/* ヘッダー */}
        <header className="w-full max-w-2xl mx-auto flex justify-end">
          <button
            onClick={toggleTheme}
            className={`px-4 py-2 rounded-full text-xs font-bold transition shadow-sm border ${
              isDark 
                ? 'bg-slate-800 text-amber-300 border-slate-700 hover:bg-slate-700' 
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {isDark ? '☀️ ライトモードにする' : '🌙 ダークモードにする'}
          </button>
        </header>

        {/* メインコンテンツ */}
        <main className="w-full max-w-2xl mx-auto my-auto py-4">
          
          {/* --- 1. ホーム画面 --- */}
          {gameState === 'home' && (
            <div className={`rounded-3xl shadow-xl p-8 text-center space-y-6 border transition-colors ${
              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
            }`}>
              <div className="space-y-3">
                <span className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider ${
                  isDark ? 'bg-emerald-950/80 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  傾向診断
                </span>
                <h1 className="text-3xl font-extrabold tracking-tight">
                  直感選択ゲーム
                </h1>
                <p className={`text-sm leading-relaxed max-w-sm mx-auto ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  あなたの直感は、世間とどれくらい一致している？<br />
                  全20問で自分の選択傾向を知ろう！
                </p>
              </div>

              {/* ユーザーネーム入力フォーム（任意） */}
              <div className="pt-2 max-w-xs mx-auto space-y-1.5 text-left">
                <label className="text-xs font-bold text-slate-400 dark:text-slate-500 px-1">
                  ユーザーネーム（任意）
                </label>
                <input
                  type="text"
                  placeholder="例: おれねこ（空欄でもOK）"
                  value={userName}
                  onChange={handleNameChange}
                  maxLength={15}
                  className={`w-full px-4 py-3 rounded-2xl text-sm font-semibold outline-none transition border ${
                    isDark 
                      ? 'bg-slate-950 border-slate-700 text-slate-100 focus:border-emerald-500' 
                      : 'bg-slate-50 border-slate-200 text-slate-800 focus:border-emerald-500'
                  }`}
                />
              </div>

              <div className="space-y-3 pt-2">
                <button
                  onClick={handleStartNew}
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/20 transition-all transform active:scale-95"
                >
                  はじめから遊ぶ
                </button>

                {hasSavedProgress && (
                  <button
                    onClick={handleResume}
                    className={`w-full py-4 bg-transparent border-2 border-emerald-500 font-bold rounded-2xl transition-all ${
                      isDark ? 'text-emerald-400 hover:bg-emerald-950/40' : 'text-emerald-600 hover:bg-emerald-50'
                    }`}
                  >
                    つづきから遊ぶ
                  </button>
                )}
              </div>
            </div>
          )}

          {/* --- 2. プレイ画面 --- */}
          {gameState === 'playing' && currentQ && (
            <div className="space-y-6">
              {/* 上部バー */}
              <div className="flex justify-between items-center">
                <span className={`text-xl sm:text-2xl font-extrabold tracking-wide ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>
                  Q.{currentQ.id}
                </span>
                <button
                  onClick={() => setGameState('home')}
                  className="bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-xs sm:text-sm px-4 py-2 rounded-full shadow-md transition"
                >
                  ホーム画面にもどる
                </button>
              </div>

              {/* 指示文 */}
              <div className="text-center py-2">
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
                  ひとつを選んでください。
                </h2>
              </div>

              {/* 3つの図形 */}
              <div className="flex flex-col md:flex-row justify-center items-center gap-4 md:gap-6 pt-2">
                {[0, 1, 2].map((idx) => {
                  const isSelected = selectedOption === idx;
                  const percentage = stats[idx];
                  const count = counts[idx];

                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelect(idx)}
                      disabled={selectedOption !== null || loadingStats}
                      className={`w-full md:w-1/3 p-6 rounded-3xl transition-all border-2 flex flex-col items-center justify-center text-center relative shadow-sm ${
                        isSelected
                          ? isDark
                            ? 'border-emerald-400 bg-emerald-950/60 text-emerald-200 shadow-lg scale-105'
                            : 'border-emerald-500 bg-emerald-50 text-emerald-900 shadow-md scale-105'
                          : selectedOption !== null
                          ? isDark
                            ? 'border-slate-800 bg-slate-900/40 text-slate-600 opacity-40'
                            : 'border-slate-200 bg-slate-100 text-slate-400 opacity-50'
                          : isDark
                            ? 'border-slate-800 bg-slate-900 hover:border-emerald-500 hover:shadow-lg cursor-pointer'
                            : 'border-slate-200 bg-white hover:border-emerald-400 hover:shadow-md cursor-pointer'
                      }`}
                    >
                      <ShapeRenderer type={currentShape} />

                      {selectedOption !== null && (
                        <div className="mt-4 space-y-1 animate-fade-in w-full">
                          <p className={`text-xl font-extrabold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                            {loadingStats ? '...' : `${percentage}% (${count}/${totalCount})`}
                          </p>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 次へボタン */}
              {selectedOption !== null && (
                <div className="pt-2">
                  <button
                    onClick={handleNext}
                    className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-2xl transition shadow-lg shadow-emerald-500/20"
                  >
                    {currentQuestionIndex + 1 === QUESTIONS.length ? '結果を見る ➔' : '次の問題へ ➔'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* --- 3. リザルト画面（全問終了） --- */}
          {gameState === 'finished' && (
            <div className={`rounded-3xl shadow-xl p-8 text-center space-y-6 border transition-colors ${
              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
            }`}>
              <div className="space-y-2">
                <h1 className="text-2xl font-bold">全問回答完了🎉</h1>
                <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  {userName.trim() ? `${userName}さん、お疲れ様でした！` : 'お疲れ様でした！'}あなたの直感のクセ/世間との合致度が測定されました。
                </p>
              </div>

              {/* 全問一致率 */}
              <div className={`border rounded-2xl p-5 space-y-1 ${
                isDark 
                  ? 'bg-emerald-950/40 border-emerald-900 text-emerald-200' 
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}>
                <p className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                  20問すべて全く同じ回答をした人
                </p>
                <p className={`text-4xl font-extrabold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                  {exactMatchPercentage !== null && exactMatchDetails !== null 
                    ? `${exactMatchPercentage}% (${exactMatchDetails.match}/${exactMatchDetails.total}人)` 
                    : '計算中...'}
                </p>
              </div>

              {/* 自身の選択割合 */}
              <div className={`border rounded-2xl p-5 text-left space-y-3 ${
                isDark ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">
                  あなたの選択した位置の割合
                </h3>

                <div className="space-y-2.5 text-xs font-semibold">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span>上 / 左</span>
                      <span className="font-bold">{tendency.pos0}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                      <div className="bg-sky-500 h-full transition-all duration-500" style={{ width: `${tendency.pos0}%` }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span>中 / 真ん中</span>
                      <span className="font-bold">{tendency.pos1}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                      <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${tendency.pos1}%` }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span>下 / 右</span>
                      <span className="font-bold">{tendency.pos2}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                      <div className="bg-amber-500 h-full transition-all duration-500" style={{ width: `${tendency.pos2}%` }}></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* シェア＆ホームに戻る */}
              <div className="space-y-3">
                <button
                  onClick={handleShare}
                  className={`w-full py-4 font-bold rounded-2xl shadow-lg transition-all flex items-center justify-center space-x-2 ${
                    isDark ? 'bg-slate-800 hover:bg-slate-700 text-white' : 'bg-black hover:bg-slate-800 text-white'
                  }`}
                >
                  <span>𝕏 で結果をシェアする</span>
                </button>

                <button
                  onClick={() => setGameState('home')}
                  className={`w-full py-3 font-semibold rounded-2xl transition ${
                    isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  ホームに戻る
                </button>
              </div>
            </div>
          )}

        </main>

        {/* フッター */}
        <footer className={`text-center text-xs py-2 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>
          © 一般交通整理団体
        </footer>

      </div>
    </div>
  );
}