/* FastLang built-in tutor: predetermined answers chosen by keywords.
 * Used by server.js whenever the AI is unavailable (no key, invalid key, network error) and by the browser
 * when the server cannot be reached at all. No dependencies.
 * reply(ctx, messages) -> { reply, suggest[] }
 * ctx = { name, lang, lesson, title, intro, head[], rows[][], notes[], practice, titles[], total, reward } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FLTutor = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  var DEFAULT_SUGGEST = ['Explain this lesson simply', 'Quiz me on it', 'Give me a memory trick', 'Useful phrases for travel'];

  /* ---------- keyword matching ---------- */
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function has(text, kw) {
    if (/[^\x00-\x7f]/.test(kw)) return text.indexOf(kw) !== -1;           // Japanese etc: plain substring
    var prefix = kw.slice(-1) === '*'; if (prefix) kw = kw.slice(0, -1);
    return new RegExp('(^|[^a-z0-9])' + esc(kw) + (prefix ? '' : '([^a-z0-9]|$)')).test(text);
  }
  function score(text, kws) { var n = 0; kws.forEach(function (k) { if (has(text, k)) n += k.indexOf(' ') > -1 ? 2 : 1; }); return n; }

  /* ---------- helpers on the lesson context ---------- */
  function ansCol(ctx) {
    for (var i = 1; i < (ctx.head || []).length; i++) if (/mean|english/i.test(ctx.head[i])) return i;
    return 1;
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function rowLine(ctx, r) {
    var c = ansCol(ctx), extra = r.filter(function (x, i) { return i !== 0 && i !== c; }).join(' / ');
    return '\u201c' + r[0] + '\u201d = ' + (r[c] || '') + (extra ? ' (' + extra + ')' : '');
  }
  function lessonOnly(ctx) { return ctx.lesson ? null : 'Open one of the lessons and ask me again - I can then use the exact phrases on that page. Meanwhile, ask about study tips, the shop or the chest.'; }

  /* ---------- answers that need the lesson on screen ---------- */
  var dyn = {
    explain: function (ctx) {
      if (!ctx.lesson) return ctx.name + ': ' + (ctx.intro || 'work through the lessons in order.') + (ctx.titles.length ? '\nLessons: ' + ctx.titles.map(function (t, i) { return (i + 1) + '. ' + t; }).join('; ') + '.' : '');
      var c = ansCol(ctx);
      return ctx.title + ': ' + (ctx.intro || '') + '\nKey items: ' + ctx.rows.slice(0, 4).map(function (r) { return r[0] + ' (' + (r[c] || '') + ')'; }).join('; ') + '.' + (ctx.notes[0] ? '\nRemember: ' + ctx.notes[0] : '');
    },
    quiz: function (ctx) {
      var m = lessonOnly(ctx); if (m) return 'Quizzes work inside a lesson. ' + m;
      if (!ctx.rows.length) return 'There is no table to quiz on in this lesson. Try the practice task instead: ' + (ctx.practice || 'write three sentences of your own.');
      var r = pick(ctx.rows);
      return 'Quiz: What does \u201c' + r[0] + '\u201d mean or how is it used? Type your answer and I will check it.';
    },
    practice: function (ctx) { return lessonOnly(ctx) || ('Your practice task: ' + (ctx.practice || 'write three sentences of your own using this lesson.') + '\nWrite it down, say it aloud, then press Complete.'); },
    notes: function (ctx) { return lessonOnly(ctx) || (ctx.notes.length ? 'Good to know:\n' + ctx.notes.map(function (n) { return '- ' + n; }).join('\n') : 'There are no extra notes on this page. Look at the table and say each item aloud.'); },
    words: function (ctx) { return lessonOnly(ctx) || ('In this lesson:\n' + ctx.rows.slice(0, 8).map(function (r) { return '- ' + rowLine(ctx, r); }).join('\n')); },
    coins: function (ctx) {
      return 'Finish every lesson in a course to unlock the chest at the end of its path. Opening it gives coins' + (ctx.reward ? ' (' + ctx.reward + ' for this course)' : ' (150 for introductory, 200 for intermediate, 250 for advanced courses)') + '. You can open each chest once. Spend coins in the Shop on streak freezes, themes, chest skins and badges.';
    },
    next: function (ctx) {
      if (ctx.lesson && ctx.total) return ctx.lesson < ctx.total ? 'Next is lesson ' + (ctx.lesson + 1) + '. Press \u201cComplete & next lesson\u201d when you are ready - lessons unlock in order.' : 'This is the last lesson! Complete it to unlock the reward chest on the course path.';
      return 'Start with the highlighted lesson on the path - lessons unlock in order. A good route is Introductory \u2192 Intermediate (or Kanji for Japanese) \u2192 Advanced.';
    }
  };

  /* ---------- the knowledge base: k = keywords, a = answer (text or function), s = follow-up chips, lang = only for that language ---------- */
  var KB = [
    { id: 'greet', k: ['hello', 'hi', 'hey', 'good morning', 'good evening', 'ciao', 'konnichiwa', 'hola', 'yo'], a: 'Hello! I am your FastLang tutor. I can explain this lesson, quiz you, share memory tricks and study plans, or explain coins and the shop. What would you like?' },
    { id: 'thanks', k: ['thanks', 'thank you', 'thx', 'cheers', 'grazie', 'arigatou', 'appreciate'], a: 'You are welcome! Small, regular steps beat long, rare sessions. Keep going.' },
    { id: 'bye', k: ['bye', 'goodbye', 'see you', 'later', 'arrivederci', 'sayonara'], a: 'See you next time! Even five minutes tomorrow keeps your streak alive.' },
    { id: 'who', k: ['who are you', 'what are you', 'your name', 'are you ai', 'are you a bot', 'are you real', 'robot'], a: 'I am the FastLang course tutor. Right now I answer from built-in tips written for these courses, so I am best at explaining your current lesson, quizzing you and giving study advice.' },
    { id: 'help', k: ['help', 'what can you do', 'options', 'commands', 'how do you work', 'menu'], a: 'I can:\n- explain this lesson simply\n- quiz you on its phrases\n- repeat the practice task and the key notes\n- explain a word from the lesson (just type it)\n- give study plans, memory and pronunciation tips\n- explain coins, chests, streaks and the shop', s: ['Explain this lesson simply', 'Quiz me on it', 'Make me a study plan'] },
    { id: 'mode', k: ['api', 'api key', 'key', 'offline', 'mode', 'claude', 'gpt', 'chatgpt', 'smart', 'ai tutor', 'not working', 'broken', 'error'], a: 'I am currently answering from built-in tips, because the AI service is not available (no valid API key is set on this server). I can still explain lessons, quiz you and answer common questions. Site owners: set a valid ANTHROPIC_API_KEY to switch on full AI answers.' },

    { id: 'explain', k: ['explain', 'summary', 'summarize', 'summarise', 'simple', 'simply', 'overview', 'what is this lesson', 'what will i learn', 'what do i learn', 'about this', 'teach me', 'lesson about', 'what.s this'], a: dyn.explain, s: ['Quiz me on it', 'What are the key notes?', 'Show the practice task'] },
    { id: 'quiz', k: ['quiz', 'test me', 'test', 'question', 'questions', 'exam', 'check me', 'examine', 'drill', 'practise me'], a: dyn.quiz, s: ['Another quiz question', 'Explain this lesson simply'] },
    { id: 'practice', k: ['practice', 'practise', 'exercise', 'homework', 'task', 'assignment', 'what should i write'], a: dyn.practice },
    { id: 'notes', k: ['notes', 'rules', 'rule', 'key notes', 'important', 'good to know', 'careful', 'watch out', 'tips for this', 'mistakes in this', 'common mistakes'], a: dyn.notes },
    { id: 'words', k: ['words', 'phrases', 'list', 'vocabulary in', 'vocab in', 'show me the', 'examples', 'example', 'sentences'], a: dyn.words },
    { id: 'next', k: ['next', 'what now', 'what.s next', 'continue', 'finished', 'done', 'complete', 'move on', 'after this', 'which course', 'where to start', 'start', 'level', 'levels'], a: dyn.next },

    { id: 'plan', k: ['plan', 'schedule', 'routine', 'daily', 'every day', 'how often', 'how long', 'how much time', 'habit', 'timetable', 'minutes', 'study plan', 'how should i study', 'how to study', 'what should i study', 'what should i do', 'study'], a: 'A simple plan that works:\n- 10-15 minutes every day beats one long weekend session.\n- Day 1: do a new lesson and say every phrase aloud.\n- Day 2: redo yesterday\'s quiz first, then the next lesson.\n- Once a week: review the whole course path for 15 minutes.\nKeep your streak alive - it builds the habit.', s: ['Give me a memory trick', 'How do streaks work?'] },
    { id: 'motivate', k: ['stuck', 'hard', 'difficult', 'frustrated', 'frustrating', 'give up', 'tired', 'bored', 'boring', 'motivation', 'motivated', 'discouraged', 'overwhelmed', 'can.t do', 'cannot do', 'too much', 'confusing', 'confused', 'lost', 'slow'], a: 'Feeling stuck is a normal part of learning a language - it usually means your brain is building something new. Try this: shrink the goal to just one table row, say it aloud three times, then make a sentence about your own day. Take a break, then come back; progress often shows up after sleep. Small wins count.', s: ['Quiz me on it', 'Give me a memory trick', 'Make me a study plan'] },
    { id: 'memory', k: ['memorize', 'memorise', 'memory', 'remember', 'vocabulary', 'vocab', 'forget', 'forgot', 'flashcard', 'flashcards', 'learn words', 'spaced', 'trick', 'tricks', 'mnemonic', 'retain', 'stick'], a: 'Memory tricks:\n- Say each phrase aloud three times, then cover the meaning and recall it.\n- Make one real sentence about your own life with each new item.\n- Use spaced repetition: review after 1 day, 3 days, then a week.\n- Link a new word to an image or a place, not just a translation.\n- Test yourself instead of re-reading - ask me for a quiz.', s: ['Quiz me on it', 'Make me a study plan'] },
    { id: 'pron', k: ['pronounce', 'pronounced', 'pronunciation', 'accent', 'how do i say', 'sound', 'sounds', 'say it', 'speak clearly', 'intonation', 'stress'], a: 'For pronunciation: listen first, then copy. Say the phrase slowly, then at normal speed; record yourself and compare with a native speaker video. Pay attention to stress and rhythm, not just single sounds.' },
    { id: 'listen', k: ['listening', 'listen', 'understand native', 'podcast', 'podcasts', 'music', 'movies', 'films', 'tv', 'subtitles', 'native speakers', 'too fast'], a: 'To train your ears: listen to short clips (1-3 minutes) several times. First without subtitles, then with subtitles in the same language, then again without. Songs, podcasts for learners and slow news are good starting points.' },
    { id: 'speak', k: ['speaking', 'speak', 'conversation', 'conversations', 'shy', 'nervous', 'confidence', 'partner', 'talk to people', 'practise speaking', 'fluent', 'fluency'], a: 'Speaking tips:\n- Talk to yourself about your day out loud.\n- Learn complete useful sentences, not single words.\n- Find a conversation partner or tutor; mistakes are how you improve.\n- Start with short, simple sentences and build up.' },
    { id: 'write', k: ['writing', 'write', 'essay', 'diary', 'journal', 'text', 'email', 'letter', 'composition'], a: 'Writing tips: keep a short daily diary (3-5 sentences) using the newest lesson. Reuse the patterns from the table, then check them against the examples. Short and correct beats long and risky.' },
    { id: 'grammar', k: ['grammar', 'tense', 'tenses', 'conjugate', 'conjugation', 'conjugations', 'verb forms', 'structure', 'sentence structure', 'word order'], a: 'Learn grammar through examples, not rules alone: take one example sentence from the table, change one word at a time, and say each new sentence aloud. The notes in each lesson list the traps to avoid.', s: ['Explain this lesson simply', 'What are the key notes?'] },
    { id: 'mistakes', k: ['mistake', 'mistakes', 'wrong', 'error', 'errors', 'incorrect', 'correct me', 'i made', 'why did i get'], a: 'Mistakes are useful data. Write down the ones you repeat, find the matching rule in the lesson notes, and make three correct sentences with it. Most errors fade after a few days of focused practice.' },
    { id: 'translate', k: ['translate', 'translation', 'how do you say', 'in japanese', 'in italian', 'in english', 'what is the word for'], a: 'In this mode I can only explain phrases that are in your lessons. Type a word or phrase from the lesson table and I will tell you what it means and how it is used.' },
    { id: 'grade', k: ['native', 'books', 'reading', 'read', 'story', 'stories', 'graded reader'], a: 'For reading, start with graded readers or children\'s stories: short, repetitive and full of everyday words. Read a page, underline 5 new words, and use them in your own sentences.' },

    { id: 'chest', k: ['chest', 'chests', 'open the chest', 'unlock', 'unlocked', 'reward chest', 'treasure', 'end of the path'], a: dyn.coins },
    { id: 'coins', k: ['coins', 'coin', 'earn', 'earning', 'money', 'rich', 'currency', 'reward', 'rewards', 'how do coins work'], a: dyn.coins, s: ['What can I buy?', 'How do streaks work?'] },
    { id: 'shop', k: ['shop', 'buy', 'spend', 'purchase', 'theme', 'themes', 'badge', 'badges', 'skin', 'skins', 'store', 'what can i buy', 'items'], a: 'The Shop (top menu, or click your coins) sells: Streak Freezes (50 coins), path themes (Sunset, Forest, Midnight), chest skins (Golden, Crystal) and badges (Fox, Panda, Owl, Dragon). Themes and skins change how your learning path looks; badges appear next to your coins.' },
    { id: 'streak', k: ['streak', 'streaks', 'freeze', 'flame', 'fire', 'daily goal', 'missed a day', 'lost my streak', 'how do streaks work'], a: 'Your streak counts the days in a row you complete at least one lesson. If you miss a day, a Streak Freeze from the Shop (it is used automatically, you can hold up to 2) keeps the streak alive.' },
    { id: 'xp', k: ['xp', 'experience points', 'points', 'level up', 'score'], a: 'You earn 10 XP for every new lesson you complete, plus a 40 XP bonus when you finish a whole course. XP shows how much you have learned; coins come from the chests.' },
    { id: 'locked', k: ['locked', 'lock', 'can.t open', 'cannot open', 'greyed', 'grey', 'skip', 'skip ahead', 'why can.t i'], a: 'Lessons unlock in order, so you build each skill on the one before. Finish the highlighted lesson on the path and the next one opens. Completed lessons can be revisited any time.' },
    { id: 'progress', k: ['progress', 'reset', 'lost progress', 'saved', 'save', 'disappeared', 'sync', 'login', 'log in', 'account', 'register', 'sign up', 'logged in'], a: 'If you are logged in, your progress, coins and purchases are saved to your account. As a guest they are stored in this browser only, so clearing browser data removes them. Log in or register to keep them safe. \u201cReset progress\u201d restarts a course\'s lessons, but coins you already earned stay yours.' },
    { id: 'courses', k: ['advanced', 'intermediate', 'beginner', 'introductory', 'courses', 'which course', 'recommend', 'in depth', 'in-depth', 'deeper', 'harder', 'more courses', 'kanji course'], a: 'Each language has three steps: Introductory (10 lessons), then Intermediate (8 lessons; Introduction to Kanji for Japanese), then Advanced (6 lessons). Finish a course to open its chest, then move on to the next level from the end of its path.' },

    /* ----- English ----- */
    { id: 'en_articles', lang: 'English', k: ['article', 'articles', 'a an the', 'the or a', 'when to use the'], a: 'Use a / an for one of many or a first mention (I saw a dog). Use the for something specific or already known (The dog was big). Use no article for general plurals and uncountables (Dogs are loyal. Water is essential).' },
    { id: 'en_prep', lang: 'English', k: ['preposition', 'prepositions', 'in on at', 'at on in', 'in or on', 'on or at'], a: 'Time: in + month/year (in May), on + day/date (on Monday), at + clock time (at 6 pm). Place: in a city or room, on a surface, at a point (at the bus stop). Learn prepositions together with their verb or adjective: afraid of, good at, interested in.' },
    { id: 'en_perfect', lang: 'English', k: ['present perfect', 'past simple', 'have been', 'have you ever', 'has been', 'since', 'for how long'], a: 'Present perfect (have + participle) links the past to now: I have lived here for five years. Past simple is for finished actions at a stated time: I moved here in 2021. A finished time word (yesterday, in 2019) always needs the past simple.' },
    { id: 'en_phrasal', lang: 'English', k: ['phrasal', 'phrasal verb', 'phrasal verbs', 'give up', 'look forward', 'put off', 'turn down', 'run out'], a: 'Phrasal verbs = verb + small word, and the meaning often changes (give up = quit). Some are separable: turn the offer down / turn down the offer, but with a pronoun it must be in the middle: turn it down. Learn them inside a sentence, not as a list.' },
    { id: 'en_cond', lang: 'English', k: ['conditional', 'conditionals', 'if sentences', 'if clause', 'would have', 'wish', 'unless'], a: 'Conditionals: zero (If you heat ice, it melts), first (If it rains, we will stay), second (If I won, I would travel), third (If I had studied, I would have passed). Never put will or would in the if-part.' },
    { id: 'en_modal', lang: 'English', k: ['modal', 'modals', 'must', 'have to', 'mustn.t', 'should', 'can or could', 'may or might'], a: 'Must = strong personal obligation; have to = an outside rule. Mustn\'t = forbidden; don\'t have to = not necessary. Should = advice. Modals have no -s in the third person and take the bare infinitive: She can swim.' },
    { id: 'en_th', lang: 'English', k: ['th sound', 'th', 'thank', 'think', 'this and that', 'r and l', 'silent letters', 'spelling'], a: 'For the English \u201cth\u201d, put the tip of your tongue lightly between your teeth: voiceless in think, voiced in this. English spelling is irregular, so learn the pronunciation together with each new word instead of guessing from the letters.' },
    { id: 'en_relative', lang: 'English', k: ['relative', 'who or which', 'which or that', 'whose', 'defining'], a: 'Who is for people, which for things, that for either in defining clauses, whose for possession. Defining clauses have no commas (The man who called is here); non-defining ones add extra information with commas (My brother, who lives in Rome, is a chef).' },

    /* ----- Japanese ----- */
    { id: 'jp_scripts', lang: 'Japanese', k: ['hiragana', 'katakana', 'kanji', 'scripts', 'alphabet', 'writing system', 'romaji', 'characters'], a: 'Japanese uses three scripts: hiragana (native words and grammar), katakana (foreign words) and kanji (meaning-carrying characters). Romaji is only a helper. Learn hiragana first, then katakana, then add kanji a few at a time - the Introduction to Kanji course does exactly that.' },
    { id: 'jp_particles', lang: 'Japanese', k: ['particle', 'particles', 'wa and ga', 'wa ga', 'は', 'が', 'を', 'に', 'で', 'へ', 'の'], a: 'Key particles: は marks the topic, が the subject, を the object, に a time, destination or target, で the place of an action or a tool, の shows possession, も means \u201calso\u201d. The particle comes right after the word it marks: 私は学生です (watashi wa gakusei desu).' },
    { id: 'jp_polite', lang: 'Japanese', k: ['polite', 'casual', 'plain form', 'desu masu', 'formal', 'informal', 'politeness', 'keigo', 'honorific', 'humble', '敬語'], a: 'Use ます/です with teachers, colleagues and strangers, and the plain form with close friends and family. Keigo goes further: respectful forms (いらっしゃる, 召し上がる) raise the other person; humble forms (申します, いただく) lower yourself. Never use respectful forms about yourself.' },
    { id: 'jp_te', lang: 'Japanese', k: ['te form', 'te-form', 'てform', 'て形', 'kudasai', 'please do', 'te kudasai'], a: 'The te-form depends on the verb ending: う/つ/る \u2192 って, む/ぶ/ぬ \u2192 んで, く \u2192 いて, ぐ \u2192 いで, す \u2192 して. 行く is the exception (行って). With ください it makes a request: 待ってください = please wait.' },
    { id: 'jp_kanji_read', lang: 'Japanese', k: ['read kanji', 'reading kanji', 'how do i read', 'on and kun', 'kanji reading', 'kanji readings', 'on reading', 'kun reading', 'onyomi', 'kunyomi', 'on.yomi', 'kun.yomi', 'readings', 'how to read kanji', 'stroke', 'stroke order', 'radical', 'radicals'], a: 'Most kanji have two kinds of readings: on\'yomi (Chinese-derived, used in compounds like 学校 gakkou) and kun\'yomi (native Japanese, used alone or with okurigana like 食べる taberu). Learn kanji inside words, and write them top to bottom, left to right, outside before inside.' },
    { id: 'jp_counter', lang: 'Japanese', k: ['counter', 'counters', 'how to count', 'numbers', 'number', 'counting'], a: 'Japanese uses counters after numbers: 人 (nin) for people, 枚 (mai) for flat things, 本 (hon) for long things, 個 (ko) for small objects. Some are irregular: 一人 hitori, 二人 futari. Learn the common counters in whole phrases.' },
    { id: 'jp_pron', lang: 'Japanese', k: ['pitch', 'long vowel', 'long vowels', 'double consonant', 'small tsu', 'っ', 'rhythm', 'mora'], a: 'Japanese is timed by beats (mora): every kana takes about the same time. Hold long vowels twice as long (おばさん vs おばあさん) and pause briefly for the small っ (きって kitte). Vowels stay pure: a, i, u, e, o.' },
    { id: 'jp_verbs', lang: 'Japanese', k: ['verb group', 'verb groups', 'ichidan', 'godan', 'ru verb', 'u verb', 'masu form', 'dictionary form'], a: 'Verbs come in groups: ichidan (ru-verbs like 食べる) drop る and add the ending; godan (u-verbs like 飲む) change the final kana; and two irregulars, する and 来る. Learn the dictionary form first, then the ます-form and the te-form.' },

    /* ----- Italian ----- */
    { id: 'it_gender', lang: 'Italian', k: ['gender', 'masculine', 'feminine', 'il or la', 'o or a', 'plural', 'plurals', 'agree', 'agreement'], a: 'Italian nouns are masculine or feminine. Most -o nouns are masculine (il libro) and most -a nouns are feminine (la casa). Plurals: -o \u2192 -i, -a \u2192 -e, -e \u2192 -i. Adjectives agree with the noun: un ragazzo alto, una ragazza alta.' },
    { id: 'it_articles', lang: 'Italian', k: ['article', 'articles', 'il lo la', 'lo or il', 'gli', 'un uno', 'articolo', 'preposizioni articolate', 'del dello'], a: 'The: il / lo / l\' / la (singular), i / gli / le (plural). Use lo and gli before s + consonant, z, gn, ps (lo zaino, gli studenti). Prepositions merge with the article: di + il = del, a + il = al, in + la = nella, su + il = sul.' },
    { id: 'it_verbs', lang: 'Italian', k: ['essere', 'avere', 'to be', 'to have', 'sono', 'ho', 'irregular', 'andare', 'fare', 'venire'], a: 'Essere (to be): sono, sei, \u00e8, siamo, siete, sono. Avere (to have): ho, hai, ha, abbiamo, avete, hanno. Very common irregulars: andare (vado, vai, va), fare (faccio, fai, fa), venire (vengo, vieni, viene). Learn these first; they appear everywhere.' },
    { id: 'it_pron', lang: 'Italian', k: ['pronounce c', 'ci and ce', 'gli sound', 'double consonant', 'double consonants', 'doppie', 'gn', 'sc', 'h silent', 'italian sounds'], a: 'Italian is pronounced as it is written. c/g are soft before e/i (ciao, gelato) and hard otherwise (casa, gatto); ch/gh make them hard before e/i (chi, spaghetti). gli sounds like \u201cly\u201d, gn like \u201cny\u201d. Double consonants are held longer: pala vs palla. The letter h is silent.' },
    { id: 'it_pp', lang: 'Italian', k: ['passato prossimo', 'participle', 'imperfetto', 'essere or avere', 'which auxiliary', 'ho or sono', 'past tense'], a: 'Passato prossimo = avere/essere + past participle (-ato, -uto, -ito). Movement and reflexive verbs use essere and the participle agrees with the subject (siamo andate). The imperfetto describes habits and background (mangiavo); the passato prossimo tells what happened.' },
    { id: 'it_subj', lang: 'Italian', k: ['congiuntivo', 'subjunctive', 'penso che', 'credo che', 'spero che'], a: 'The congiuntivo follows opinion, wish, doubt and emotion when the subject changes: Penso che Marco sia stanco; Voglio che tu venga. If the subject stays the same, use di + infinitive: Penso di essere stanco.' },
    { id: 'it_tu', lang: 'Italian', k: ['tu or lei', 'formal', 'informal', 'polite', 'lei', 'voi', 'you formal', 'how to address'], a: 'Use tu with friends, family and young people; use Lei (with the 3rd-person verb) with strangers, older people and in formal situations: Come sta? vs Come stai? You will also hear voi for \u201cyou all\u201d.' },
    { id: 'it_pronouns', lang: 'Italian', k: ['object pronoun', 'object pronouns', 'lo la li le', 'mi ti', 'pronomi', 'ci and ne', 'ne', 'ci'], a: 'Pronouns go before a conjugated verb (Lo vedo) but attach to an infinitive (Voglio vederlo). Direct: lo, la, li, le. Indirect: mi, ti, gli, le, ci, vi. Ci replaces a place or topic (Ci vado), ne replaces a quantity or topic (Ne voglio due).' }
  ];

  /* =====================================================================================
   * v6: many more predetermined answers.
   * PH = ready-made phrasebook, one block per topic and language (English / Japanese / Italian).
   * KB2 = extra entries; they are appended to KB below. "w" gives an entry a small bonus so a
   * specific phrase request beats a generic keyword ("how do i say thank you" -> phrasebook).
   * ===================================================================================== */
  function L() { return Array.prototype.join.call(arguments, '\n'); }
  var PH = {
    greet: { label: 'Greetings',
      English: L('- Hello! / Hi! (any time)', '- Good morning / Good afternoon / Good evening', '- How are you? \u2192 Fine, thanks. And you?', '- Goodbye! / See you later! / Take care!'),
      Japanese: L('- \u304a\u306f\u3088\u3046\u3054\u3056\u3044\u307e\u3059 (ohayou gozaimasu) = good morning', '- \u3053\u3093\u306b\u3061\u306f (konnichiwa) = hello / good afternoon', '- \u3053\u3093\u3070\u3093\u306f (konbanwa) = good evening', '- \u304a\u3084\u3059\u307f\u306a\u3055\u3044 (oyasuminasai) = good night', '- \u3055\u3088\u3046\u306a\u3089 (sayounara) = goodbye, \u307e\u305f\u306d (mata ne) = see you'),
      Italian: L('- Buongiorno = good morning / good day', '- Buonasera = good evening', '- Ciao = hi / bye (informal)', '- Buonanotte = good night', '- Arrivederci = goodbye, A presto = see you soon') },
    intro: { label: 'Introducing yourself',
      English: L('- Nice to meet you.', '- My name is ... / I\'m ...', '- I\'m from ... and I live in ...', '- I\'m learning English.'),
      Japanese: L('- \u306f\u3058\u3081\u307e\u3057\u3066 (hajimemashite) = nice to meet you (first time)', '- \u79c1\u306f...\u3067\u3059 (watashi wa ... desu) = I am ...', '- ...\u304b\u3089\u6765\u307e\u3057\u305f (... kara kimashita) = I come from ...', '- \u3088\u308d\u3057\u304f\u304a\u9858\u3044\u3057\u307e\u3059 (yoroshiku onegaishimasu) = pleased to meet you / please be kind to me'),
      Italian: L('- Piacere = nice to meet you', '- Mi chiamo ... = my name is ...', '- Sono di ... / Vivo a ... = I\'m from ... / I live in ...', '- Parli inglese? = do you speak English?') },
    thanks: { label: 'Thank you / you are welcome',
      English: L('- Thank you. / Thanks a lot.', '- You\'re welcome. / No problem. / My pleasure.'),
      Japanese: L('- \u3042\u308a\u304c\u3068\u3046 (arigatou) = thanks (casual)', '- \u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059 (arigatou gozaimasu) = thank you (polite)', '- \u3069\u3046\u3044\u305f\u3057\u307e\u3057\u3066 (douitashimashite) = you\'re welcome'),
      Italian: L('- Grazie = thank you, Grazie mille = thanks a lot', '- Prego = you\'re welcome') },
    sorry: { label: 'Sorry / excuse me',
      English: L('- Sorry! / I\'m so sorry. (you made a mistake)', '- Excuse me, ... (to get attention or pass someone)', '- Pardon? (you did not hear)'),
      Japanese: L('- \u3059\u307f\u307e\u305b\u3093 (sumimasen) = excuse me / sorry', '- \u3054\u3081\u3093\u306a\u3055\u3044 (gomennasai) = I\'m sorry, \u3054\u3081\u3093 (gomen) = sorry (casual)'),
      Italian: L('- Scusi (formal) / Scusa (informal) = excuse me', '- Mi dispiace = I\'m sorry', '- Permesso? = may I come in / pass?') },
    restaurant: { label: 'Restaurant',
      English: L('- A table for two, please.', '- Could I have the menu, please?', '- I\'d like the soup, please.', '- Could we have the bill, please?'),
      Japanese: L('- \u30e1\u30cb\u30e5\u30fc\u3092\u304f\u3060\u3055\u3044 (menyuu o kudasai) = the menu, please', '- \u3053\u308c\u3092\u304f\u3060\u3055\u3044 (kore o kudasai) = this one, please', '- \u304a\u4f1a\u8a08\u3092\u304a\u9858\u3044\u3057\u307e\u3059 (okaikei o onegaishimasu) = the bill, please', '- \u3044\u305f\u3060\u304d\u307e\u3059 (itadakimasu) before eating, \u3054\u3061\u305d\u3046\u3055\u307e\u3067\u3057\u305f (gochisousama deshita) after'),
      Italian: L('- Un tavolo per due, per favore.', '- Il menu, per favore. / Vorrei ... = I would like ...', '- Il conto, per favore.', '- Buon appetito! = enjoy your meal') },
    directions: { label: 'Asking directions',
      English: L('- Excuse me, how do I get to the station?', '- Is it far from here?', '- Turn left / turn right / go straight on.', '- It\'s next to the bank, opposite the park.'),
      Japanese: L('- ...\u306f\u3069\u3053\u3067\u3059\u304b (... wa doko desu ka) = where is ...?', '- \u307e\u3063\u3059\u3050 (massugu) = straight, \u53f3 (migi) = right, \u5de6 (hidari) = left', '- \u99c5 (eki) = station'),
      Italian: L('- Scusi, dov\'\u00e8 la stazione?', '- A destra = right, a sinistra = left, sempre dritto = straight on', '- \u00c8 lontano? = is it far?') },
    shopping: { label: 'Shopping',
      English: L('- How much is this?', '- Can I pay by card?', '- Do you have this in a bigger size?', '- I\'m just looking, thanks.'),
      Japanese: L('- \u3044\u304f\u3089\u3067\u3059\u304b (ikura desu ka) = how much is it?', '- \u9ad8\u3044 (takai) = expensive, \u5b89\u3044 (yasui) = cheap', '- \u30ab\u30fc\u30c9\u306f\u4f7f\u3048\u307e\u3059\u304b (kaado wa tsukaemasu ka) = can I use a card?'),
      Italian: L('- Quanto costa? = how much is it?', '- Posso pagare con la carta?', '- \u00c8 troppo caro. = it\'s too expensive', '- Sto solo guardando, grazie.') },
    hotel: { label: 'Hotel',
      English: L('- I have a reservation under the name ...', '- What time is check-out?', '- Is breakfast included?', '- Could I have a late check-out?'),
      Japanese: L('- \u4e88\u7d04\u304c\u3042\u308a\u307e\u3059 (yoyaku ga arimasu) = I have a reservation', '- \u90e8\u5c4b (heya) = room', '- \u671d\u3054\u306f\u3093\u306f\u4f55\u6642\u3067\u3059\u304b (asagohan wa nanji desu ka) = what time is breakfast?'),
      Italian: L('- Ho una prenotazione. = I have a reservation', '- Una camera singola / doppia = a single / double room', '- A che ora \u00e8 la colazione? = what time is breakfast?') },
    emergency: { label: 'Emergencies',
      English: L('- Help! / Call the police! / Call an ambulance!', '- I need a doctor.', '- Where is the nearest hospital / pharmacy?'),
      Japanese: L('- \u52a9\u3051\u3066 (tasukete) = help!', '- \u8b66\u5bdf (keisatsu) = police, \u6551\u6025\u8eca (kyuukyuusha) = ambulance', '- \u75c5\u9662\u306f\u3069\u3053\u3067\u3059\u304b (byouin wa doko desu ka) = where is the hospital?'),
      Italian: L('- Aiuto! = help!', '- Chiami la polizia / un\'ambulanza!', '- Ho bisogno di un medico. = I need a doctor', '- Dov\'\u00e8 l\'ospedale / la farmacia?') },
    numbers: { label: 'Counting 1-10',
      English: L('- one, two, three, four, five, six, seven, eight, nine, ten', '- Careful: thirteen /\u03b8\u025c\u02d0\u02c8tiːn/ (stress on -teen) vs thirty /\u02c8\u03b8\u025c\u02d0ti/ (stress on thir-).'),
      Japanese: L('- \u4e00 ichi, \u4e8c ni, \u4e09 san, \u56db shi / yon, \u4e94 go', '- \u516d roku, \u4e03 shichi / nana, \u516b hachi, \u4e5d kyuu / ku, \u5341 juu'),
      Italian: L('- uno, due, tre, quattro, cinque, sei, sette, otto, nove, dieci', '- 11 undici, 12 dodici, 20 venti, 30 trenta, 100 cento') },
    days: { label: 'Days of the week',
      English: L('- Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday', '- Always write them with a capital letter.'),
      Japanese: L('- \u6708\u66dc\u65e5 getsuyoubi (Mon), \u706b\u66dc\u65e5 kayoubi (Tue), \u6c34\u66dc\u65e5 suiyoubi (Wed)', '- \u6728\u66dc\u65e5 mokuyoubi (Thu), \u91d1\u66dc\u65e5 kinyoubi (Fri), \u571f\u66dc\u65e5 doyoubi (Sat), \u65e5\u66dc\u65e5 nichiyoubi (Sun)'),
      Italian: L('- luned\u00ec, marted\u00ec, mercoled\u00ec, gioved\u00ec, venerd\u00ec, sabato, domenica', '- Written with a small letter in Italian.') },
    colors: { label: 'Colours',
      English: L('- red, blue, yellow, green, white, black, orange, pink, purple, brown, grey'),
      Japanese: L('- \u8d64 aka (red), \u9752 ao (blue), \u9ec4\u8272 kiiro (yellow), \u7dd1 midori (green)', '- \u767d shiro (white), \u9ed2 kuro (black)'),
      Italian: L('- rosso, blu, giallo, verde, bianco, nero, arancione, rosa, viola', '- Colour adjectives agree with the noun: una casa bianca, due case bianche.') },
    family: { label: 'Family',
      English: L('- mother (mum), father (dad), brother, sister, grandmother, grandfather, son, daughter', '- parents = mother and father'),
      Japanese: L('- Your own family: \u6bcd haha, \u7236 chichi, \u5144 ani, \u59c9 ane, \u5f1f otouto, \u59b9 imouto', '- Someone else\'s family: \u304a\u6bcd\u3055\u3093 okaasan, \u304a\u7236\u3055\u3093 otousan, \u304a\u5144\u3055\u3093 oniisan, \u304a\u59c9\u3055\u3093 oneesan'),
      Italian: L('- madre (mamma), padre (pap\u00e0), fratello, sorella, nonno, nonna, figlio, figlia', '- i genitori = parents') },
    weather: { label: 'Weather',
      English: L('- What\'s the weather like? \u2192 It\'s sunny / rainy / windy / cloudy.', '- It\'s freezing! / It\'s boiling!'),
      Japanese: L('- \u4eca\u65e5\u306f\u6691\u3044\u3067\u3059\u306d (kyou wa atsui desu ne) = it\'s hot today, isn\'t it', '- \u5bd2\u3044 samui (cold), \u96e8 ame (rain), \u6674\u308c hare (sunny)'),
      Italian: L('- Che tempo fa? = what\'s the weather like?', '- Fa caldo / Fa freddo / Piove / C\'\u00e8 il sole') },
    time: { label: 'Telling the time',
      English: L('- What time is it? \u2192 It\'s half past three. / It\'s quarter to five.', '- What time does it start? \u2192 At six o\'clock.'),
      Japanese: L('- \u4f55\u6642\u3067\u3059\u304b (nanji desu ka) = what time is it?', '- \u4e00\u6642 ichiji, \u56db\u6642 yoji, \u4e5d\u6642 kuji (careful: not yonji / kyuuji)', '- \u534a (han) = half past, \u5206 (fun / pun) = minutes'),
      Italian: L('- Che ore sono? = what time is it?', '- Sono le tre. / \u00c8 mezzogiorno. / \u00c8 l\'una.', '- A che ora ...? = at what time ...?') },
    love: { label: 'Liking and loving',
      English: L('- I like you. (friendly or romantic, depends on tone)', '- I love you. (strong, for partners and family)', '- I miss you.'),
      Japanese: L('- \u597d\u304d\u3067\u3059 (suki desu) = I like you', '- \u611b\u3057\u3066\u308b (ai shiteru) = I love you (very strong, rarely said)'),
      Italian: L('- Mi piaci. = I like you', '- Ti voglio bene. = I love you (friends, family)', '- Ti amo. = I love you (romantic)') },
    help: { label: 'When you do not understand',
      English: L('- Sorry, could you repeat that?', '- Could you speak more slowly, please?', '- I don\'t understand. / What does ... mean?'),
      Japanese: L('- \u3082\u3046\u4e00\u5ea6\u304a\u9858\u3044\u3057\u307e\u3059 (mou ichido onegaishimasu) = once more, please', '- \u3086\u3063\u304f\u308a\u8a71\u3057\u3066\u304f\u3060\u3055\u3044 (yukkuri hanashite kudasai) = please speak slowly', '- \u5206\u304b\u308a\u307e\u305b\u3093 (wakarimasen) = I don\'t understand'),
      Italian: L('- Non capisco. = I don\'t understand', '- Pu\u00f2 ripetere, per favore? = could you repeat?', '- Pi\u00f9 lentamente, per favore. = more slowly, please', '- Come si dice ...? = how do you say ...?') },
    cheers: { label: 'Toasts',
      English: L('- Cheers! / Bottoms up!'), Japanese: L('- \u4e7e\u676f (kanpai) = cheers!'), Italian: L('- Cin cin! / Salute! = cheers!') },
    birthday: { label: 'Celebrations',
      English: L('- Happy birthday! / Congratulations! / Happy New Year! / Merry Christmas!'),
      Japanese: L('- \u304a\u8a95\u751f\u65e5\u304a\u3081\u3067\u3068\u3046 (otanjoubi omedetou) = happy birthday', '- \u304a\u3081\u3067\u3068\u3046 (omedetou) = congratulations', '- \u3042\u3051\u307e\u3057\u3066\u304a\u3081\u3067\u3068\u3046\u3054\u3056\u3044\u307e\u3059 = happy new year'),
      Italian: L('- Buon compleanno! / Congratulazioni! / Buon anno! / Buon Natale!') },
    job: { label: 'Talking about your job',
      English: L('- I\'m a student. / I\'m a teacher. / I work as an engineer.', '- I work for a small company. / I work from home.'),
      Japanese: L('- \u79c1\u306f\u5b66\u751f\u3067\u3059 (watashi wa gakusei desu) = I\'m a student', '- \u5148\u751f\u3067\u3059 (sensei desu) = I\'m a teacher, \u4f1a\u793e\u54e1 (kaishain) = office worker', '- ...\u3067\u50cd\u3044\u3066\u3044\u307e\u3059 (... de hataraite imasu) = I work at ...'),
      Italian: L('- Sono studente (m) / studentessa (f). / Sono insegnante.', '- Lavoro in un\'azienda. = I work in a company', '- Faccio l\'ingegnere. = I\'m an engineer') },
    hobby: { label: 'Hobbies and free time',
      English: L('- In my free time I like reading and playing football.', '- I enjoy cooking. (enjoy + -ing)'),
      Japanese: L('- \u8da3\u5473\u306f\u97f3\u697d\u3067\u3059 (shumi wa ongaku desu) = my hobby is music', '- \u6620\u753b\u3092\u898b\u308b\u306e\u304c\u597d\u304d\u3067\u3059 (eiga o miru no ga suki desu) = I like watching movies'),
      Italian: L('- Nel tempo libero mi piace leggere. = in my free time I like reading', '- Il mio hobby \u00e8 la fotografia.') },
    opinion: { label: 'Opinions',
      English: L('- I agree. / I don\'t agree. / I\'m not sure.', '- In my opinion, ... / I think that ...'),
      Japanese: L('- \u305d\u3046\u601d\u3044\u307e\u3059 (sou omoimasu) = I think so', '- \u79c1\u306f...\u3068\u601d\u3044\u307e\u3059 (watashi wa ... to omoimasu) = I think that ...', '- \u8cdb\u6210\u3067\u3059 (sansei desu) = I agree'),
      Italian: L('- Sono d\'accordo. / Non sono d\'accordo.', '- Secondo me, ... = in my opinion', '- Penso che + congiuntivo: Penso che sia giusto.') },
    invite: { label: 'Invitations',
      English: L('- Would you like to have coffee?', '- Let\'s go to the cinema on Friday.', '- Sounds great! / Sorry, I can\'t make it.'),
      Japanese: L('- \u4e00\u7dd2\u306b\u98df\u3079\u307e\u305b\u3093\u304b (issho ni tabemasen ka) = shall we eat together?', '- \u3044\u3044\u3067\u3059\u306d (ii desu ne) = sounds good', '- \u3054\u3081\u3093\u306a\u3055\u3044\u3001\u3061\u3087\u3063\u3068... = sorry, that is a bit difficult (soft no)'),
      Italian: L('- Ti va di prendere un caff\u00e8? = do you feel like a coffee?', '- Andiamo al cinema! = let\'s go to the cinema', '- Volentieri! = gladly! / Mi dispiace, non posso.') },
    polite: { label: 'Polite requests',
      English: L('- Could you help me, please?', '- Would you mind opening the window?', '- May I sit here?'),
      Japanese: L('- ...\u3092\u304f\u3060\u3055\u3044 (... o kudasai) = ..., please', '- ...\u3066\u3082\u3044\u3044\u3067\u3059\u304b (... te mo ii desu ka) = may I ...?', '- ...\u3066\u3044\u305f\u3060\u3051\u307e\u305b\u3093\u304b (... te itadakemasen ka) = could you possibly ...? (very polite)'),
      Italian: L('- Vorrei un caff\u00e8, per favore. = I would like a coffee', '- Posso entrare? = may I come in?', '- Mi pu\u00f2 aiutare? = could you help me?') },
    smalltalk: { label: 'Small talk starters',
      English: L('- Have you been here before?', '- What do you do?', '- Nice weather today, isn\'t it?'),
      Japanese: L('- \u304a\u4ec1\u4e8b\u306f\u4f55\u3092\u3055\u308c\u3066\u3044\u307e\u3059\u304b = what do you do for work? (polite)', '- \u4eca\u65e5\u306f\u3044\u3044\u5929\u6c17\u3067\u3059\u306d (kyou wa ii tenki desu ne) = nice weather today'),
      Italian: L('- Di dove sei? = where are you from?', '- Che bella giornata, vero? = nice day, isn\'t it?', '- Cosa fai nella vita? = what do you do?') }
  };
  function phr(topic) {
    return function (ctx) {
      var t = PH[topic], lang = t[ctx.lang] ? ctx.lang : 'English';
      return t.label + ' in ' + lang + ':\n' + t[lang];
    };
  }
  function topicList(ctx) {
    return 'I have ready-made phrases for: greetings, introductions, thank you, sorry, restaurant, asking directions, shopping, hotel, emergencies, numbers, days, colours, family, weather, telling the time, liking and loving, small talk, hobbies, jobs, opinions, invitations, polite requests, toasts and celebrations. Just ask, for example \u201cRestaurant phrases\u201d, in ' + (ctx.lang || 'this language') + '.';
  }
  var JOKES = [
    'Why did the student bring a ladder to class? To reach a higher level!',
    'Learning tip disguised as a joke: in Italian, if you talk with your hands you already know half the language.',
    'A teacher asks: \u201cWhat is the past tense of \u2018think\u2019?\u201d A student says: \u201cI thought so.\u201d',
    'Japanese tip: \u732b (neko) is cat and \u72ac (inu) is dog. Remember: the cat is the one that looks down on you.'
  ];
  var MORE_SUGGEST = ['Restaurant phrases', 'Make me a study plan', 'Tell me a joke'];

  var KB2 = [
    /* ----- small talk ----- */
    { id: 'howareyou', k: ['how are you', 'how are you doing', 'how.s it going', 'whats up', 'what.s up', 'how do you do'], w: 1, a: function () { return pick(['I am doing great, thanks for asking! Ready to practise whenever you are.', 'Very well! Learning languages is my favourite thing. What shall we do?']); }, s: ['Quiz me on it', 'Explain this lesson simply', 'Tell me a joke'] },
    { id: 'joke', k: ['joke', 'jokes', 'funny', 'make me laugh', 'tell me a joke'], w: 1, a: function () { return pick(JOKES); }, s: ['Another joke', 'Quiz me on it'] },
    { id: 'joke2', k: ['another joke', 'one more joke'], w: 2, a: function () { return pick(JOKES); }, s: ['Quiz me on it'] },
    { id: 'praise', k: ['great', 'awesome', 'cool', 'amazing', 'love it', 'good job', 'well done', 'fun', 'perfect', 'excellent', 'super'], a: 'Glad you like it! Keep it up - want a quick quiz to lock it in?', s: ['Quiz me on it', 'Show the practice task'] },
    { id: 'okay', k: ['ok', 'okay', 'got it', 'i see', 'understood', 'alright', 'sure', 'yes', 'yeah', 'yep', 'right'], a: 'Great! What would you like to do next?', s: ['Quiz me on it', 'Explain this lesson simply', 'Make me a study plan'] },
    { id: 'no', k: ['no', 'nope', 'nah', 'not really', 'no thanks'], a: 'No problem. Tell me what you would like instead, or pick one of these.', s: ['Explain this lesson simply', 'Quiz me on it', 'Give me a memory trick'] },
    { id: 'sorry_user', k: ['sorry', 'my bad', 'apologies', 'oops'], a: 'No need to apologise - mistakes are exactly how languages are learned!' },
    { id: 'where', k: ['where are you from', 'how old are you', 'where do you live', 'do you sleep', 'do you eat', 'are you human'], a: 'I am a program living on the FastLang server, so no age, no sleep and no lunch. But I never get tired of explaining grammar.' },
    { id: 'fav', k: ['favorite', 'favourite', 'what do you like', 'best language'], a: 'Every language has something fun: Italian sounds like music, Japanese has three writing systems to play with, and English connects you with almost everyone. Which one makes you curious?' },
    { id: 'wrong', k: ['you are wrong', 'that.s wrong', 'you.re wrong', 'incorrect answer', 'you made a mistake', 'not correct'], a: 'Thanks for telling me - my built-in answers are short and can miss details. Please check the lesson table and notes on the page, and ask your instructor if the two disagree.' },
    { id: 'repeat', k: ['again', 'repeat', 'say that again', 'i did not understand', 'explain again', 'what do you mean', 'simpler'], a: 'Sure. Pick what is easier for you: a shorter explanation of the lesson, a quiz, or a memory trick.', s: ['Explain this lesson simply', 'Quiz me on it', 'Give me a memory trick'] },

    /* ----- study advice ----- */
    { id: 'fast', k: ['learn fast', 'fastest way', 'quickly', 'faster', 'speed up', 'shortcut', 'how long will it take', 'how many months', 'when will i be fluent', 'learn in a month'], a: 'There is no magic shortcut, but these speed things up:\n- Study every day, even 10 minutes.\n- Learn the most common words and phrases first.\n- Speak from day one, even to yourself.\n- Review with quizzes, not by re-reading.\nBasic conversations usually take months of regular practice, not weeks.', s: ['Make me a study plan', 'Give me a memory trick'] },
    { id: 'immersion', k: ['immersion', 'think in', 'stop translating', 'translate in my head', 'translating in my head', 'immerse'], a: 'To stop translating in your head: label things around you in the new language, narrate simple actions (\u201cI am making tea\u201d), and change your phone to that language. Start with whole phrases, not word-by-word translation.' },
    { id: 'shadow', k: ['shadowing', 'repeat after', 'echo', 'copy native', 'imitate'], a: 'Shadowing: play a short clip (10-20 seconds) and say it together with the speaker, copying rhythm, stress and melody. Repeat the same clip 5 times over several days. It trains pronunciation and fluency at the same time.' },
    { id: 'tools', k: ['dictionary', 'apps', 'app', 'tools', 'resources', 'websites', 'which app', 'what app', 'extra material', 'extra materials'], a: 'Useful extras next to FastLang: a good online dictionary, a flashcard app with spaced repetition, short videos or podcasts for learners, and a language partner to talk to. In the top menu, Partner chat lets you meet other learners online.', s: ['Find a language partner', 'Make me a study plan'] },
    { id: 'howmany', k: ['how many words', 'how many kanji', 'how many phrases', 'words per day', 'new words a day', 'how many new', 'words a day'], a: 'A realistic pace is 5-10 new items a day - for example one lesson table row set - plus a short review of yesterday\'s. Ten items you really remember beat fifty you forget.' },
    { id: 'sleep', k: ['sleep', 'sleeping', 'before bed', 'best time', 'morning or evening', 'what time should i study', 'when should i study'], a: 'Study whenever you can be regular. A short review just before bed helps memory, and a quick recap the next morning locks it in. Avoid cramming late at night - sleep does part of the learning for you.' },
    { id: 'breaks', k: ['break', 'rest', 'burnout', 'burned out', 'pause', 'take a day off', 'holiday from studying'], a: 'Breaks are part of learning. After 25-30 minutes take 5 minutes off. If you miss a day, simply restart with a 5-minute review - a Streak Freeze from the Shop can protect your streak.' },
    { id: 'review', k: ['review', 'revise', 'revision', 'repetition', 'revisit', 'go back', 'old lessons'], a: 'Review on a schedule: the next day, after 3 days, after a week, after a month. Reopen an earlier lesson, cover the meanings, and recall each phrase aloud. Finished lessons stay open on the path.' },
    { id: 'goals', k: ['goal', 'goals', 'target', 'why learn', 'reason to learn', 'set goals', 'my aim'], a: 'Set a small, concrete goal, for example \u201cin 4 weeks I can introduce myself and order food\u201d. Then plan 10-15 minutes a day. Goals with a date and a real situation keep motivation high.', s: ['Make me a study plan', 'Introducing yourself'] },
    { id: 'exams', k: ['ielts', 'toefl', 'jlpt', 'cils', 'celi', 'cambridge', 'certificate', 'certification', 'proficiency', 'cefr', 'exam preparation', 'language exam'], a: function (ctx) {
        var e = { English: 'For English the common exams are IELTS, TOEFL and the Cambridge exams (levels A1-C2).', Japanese: 'For Japanese the standard exam is the JLPT (levels N5 easiest to N1 hardest).', Italian: 'For Italian the common exams are CILS and CELI (levels A1-C2).' };
        return (e[ctx.lang] || 'Check which exam your goal needs.') + ' FastLang gives you the foundations (Introductory, Intermediate, Advanced); before an exam also practise past papers from the exam organiser and check the official syllabus.';
      } },
    { id: 'partner_find', k: ['language partner', 'find a partner', 'find a language partner', 'talk to someone', 'chat with users', 'chat with a person', 'practice with people', 'practise with people', 'pen pal', 'penpal', 'tandem', 'language exchange', 'other learners', 'chat with other users'], w: 1, a: 'You can talk to real people! Open Partner chat in the top menu (you need to be logged in). Set the language you speak and the one you are learning, press \u201cFind me a partner\u201d and the site will suggest someone online whose languages match yours. Chat is live, and messages are kept so you can continue later.', s: ['How does Partner chat work?', 'Speaking tips'] },
    { id: 'partner_how', k: ['how does partner chat work', 'partner chat', 'online chat', 'chat with other users', 'how does the chat work', 'user chat'], w: 2, a: 'Partner chat: 1) log in and open Partner chat from the menu; 2) choose your native and learning language; 3) pick someone from the Online list or press \u201cFind me a partner\u201d; 4) write - the other person sees it instantly and you can see when they type. Be kind, correct each other gently and never share passwords or private data.', s: ['Speaking tips', 'Make me a study plan'] },
    { id: 'safety', k: ['safe', 'safety', 'privacy', 'private', 'report', 'block', 'bad user', 'rude user', 'stranger'], a: 'Stay safe online: never share passwords, bank details or your home address with someone you meet in chat. Keep conversations about language and everyday topics. If someone is rude, stop replying and tell the site owners through the Contact page.' },

    /* ----- phrasebook ----- */
    { id: 'travel', k: ['travel', 'trip', 'vacation', 'holiday', 'phrases for', 'useful phrases', 'phrasebook', 'survival phrases', 'common phrases', 'basic phrases', 'everyday phrases', 'useful phrases for travel'], w: 1, a: topicList, s: ['Restaurant phrases', 'Asking directions', 'Greetings'] },
    { id: 'ph_greet', k: ['how to greet', 'greetings', 'greeting', 'say hello', 'good morning in', 'greet someone', 'ways to say hello', 'hello in'], w: 1, a: phr('greet'), s: ['Introducing yourself', 'Thank you in this language'] },
    { id: 'ph_intro', k: ['introduce myself', 'introducing yourself', 'introduce', 'my name is', 'nice to meet', 'introduce myself', 'introduction'], w: 1, a: phr('intro'), s: ['Small talk starters', 'Talking about my job'] },
    { id: 'ph_thanks', k: ['say thank you', 'say thanks', 'how to thank', 'thank you in', 'thanks in', 'you.re welcome in', 'thank you in this language'], w: 1, a: phr('thanks') },
    { id: 'ph_sorry', k: ['say sorry', 'how to say sorry', 'apologise in', 'apologize in', 'excuse me in', 'sorry in', 'how to apologise', 'how to apologize'], w: 1, a: phr('sorry') },
    { id: 'ph_rest', k: ['restaurant', 'restaurants', 'order food', 'menu', 'waiter', 'the bill', 'cafe', 'coffee', 'eat out', 'eating out', 'ordering food', 'at a restaurant', 'restaurant phrases'], w: 1, a: phr('restaurant'), s: ['Asking directions', 'Shopping phrases', 'Polite requests'] },
    { id: 'ph_dir', k: ['ask directions', 'asking directions', 'directions', 'how do i get to', 'get to the', 'taxi', 'train station', 'bus stop', 'metro', 'airport'], w: 1, a: phr('directions'), s: ['Restaurant phrases', 'Hotel phrases'] },
    { id: 'ph_shop', k: ['shopping', 'shopping phrases', 'how much is', 'how much does', 'price', 'prices', 'cheap', 'expensive', 'bargain', 'pay by card', 'at the market'], w: 1, a: phr('shopping') },
    { id: 'ph_hotel', k: ['hotel', 'hotels', 'hostel', 'book a room', 'reservation', 'check in', 'check-in', 'check out', 'check-out', 'accommodation', 'hotel phrases'], w: 1, a: phr('hotel') },
    { id: 'ph_emer', k: ['emergency', 'emergencies', 'police', 'ambulance', 'doctor', 'hospital', 'pharmacy', 'call the police', 'call an ambulance', 'i need a doctor'], w: 1, a: phr('emergency') },
    { id: 'ph_num', k: ['count to ten', 'count to 10', 'one to ten', '1 to 10', 'numbers 1', 'numbers in', 'how do you count', 'count to', 'counting 1'], w: 1, a: phr('numbers') },
    { id: 'ph_days', k: ['days of the week', 'weekdays', 'week days', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], w: 1, a: phr('days') },
    { id: 'ph_colors', k: ['colors', 'colours', 'color', 'colour', 'red', 'blue', 'green', 'yellow', 'black', 'white'], w: 1, a: phr('colors') },
    { id: 'ph_family', k: ['family', 'mother', 'father', 'brother', 'sister', 'parents', 'grandmother', 'grandfather', 'mom', 'dad', 'mum', 'family members'], w: 1, a: phr('family') },
    { id: 'ph_weather', k: ['weather', 'raining', 'rain', 'sunny', 'temperature', 'snow', 'it.s cold', 'it.s hot'], w: 1, a: phr('weather') },
    { id: 'ph_time', k: ['what time is it', 'telling time', 'tell the time', 'ask the time', 'o.clock', 'clock', 'time in'], w: 1, a: phr('time') },
    { id: 'ph_love', k: ['i love you', 'love you', 'romantic', 'girlfriend', 'boyfriend', 'flirt', 'on a date', 'i like you', 'i miss you', 'compliment someone'], w: 1, a: phr('love') },
    { id: 'ph_help', k: ['say i don.t understand', 'ask someone to repeat', 'repeat that', 'speak slowly', 'speak slower', 'can you repeat', 'when i don.t understand', 'i don.t understand'], w: 1, a: phr('help') },
    { id: 'ph_cheers', k: ['make a toast', 'toast', 'kanpai', 'cin cin', 'say cheers', 'cheers in', 'drinking'], w: 2, a: phr('cheers') },
    { id: 'ph_bday', k: ['birthday', 'congratulations', 'congrats', 'happy birthday', 'celebrate', 'wedding', 'new year', 'merry christmas'], w: 1, a: phr('birthday') },
    { id: 'ph_job', k: ['my job', 'occupation', 'profession', 'i am a student', 'i.m a student', 'what do you do for work', 'talk about my job', 'work phrases', 'talking about my job'], w: 1, a: phr('job') },
    { id: 'ph_hobby', k: ['hobby', 'hobbies', 'free time', 'interests', 'what do you like to do', 'sports', 'talk about my hobbies', 'talking about hobbies'], w: 1, a: phr('hobby') },
    { id: 'ph_opinion', k: ['i agree', 'disagree', 'opinion', 'in my opinion', 'express my opinion', 'how to agree', 'give an opinion', 'opinions'], w: 1, a: phr('opinion') },
    { id: 'ph_invite', k: ['invite', 'invitation', 'invitations', 'let.s go', 'would you like to', 'join me', 'make plans', 'meet up', 'hang out'], w: 1, a: phr('invite') },
    { id: 'ph_polite', k: ['polite request*', 'ask politely', 'how to ask for', 'how do i ask for', 'ask for something', 'request something', 'may i', 'could you please'], w: 1, a: phr('polite') },
    { id: 'ph_small', k: ['small talk', 'make conversation', 'start a conversation', 'conversation starters', 'chat with a stranger', 'ice breaker', 'icebreaker'], w: 1, a: phr('smalltalk') },

    /* ----- English grammar ----- */
    { id: 'en_present', lang: 'English', k: ['present simple', 'present continuous', 'present progressive', 'i work or i am working', 'stative verbs', 'routine'], a: 'Present simple = habits and facts (I work every day. Water boils at 100\u00b0C). Present continuous = happening now or around now (I am working at the moment). Verbs of state (know, like, want, understand) are normally not used in the continuous: I know the answer, not \u201cI am knowing\u201d.' },
    { id: 'en_count', lang: 'English', k: ['much or many', 'countable', 'uncountable', 'much', 'many', 'a lot of', 'few and little', 'a few', 'a little', 'less or fewer', 'fewer'], a: 'Many/few/fewer go with countable nouns (many books, a few friends). Much/little/less go with uncountable nouns (much water, a little time). \u201cA lot of\u201d works with both. Much is mostly used in questions and negatives: How much money do you have? I don\'t have much time.' },
    { id: 'en_compare', lang: 'English', k: ['comparative', 'comparatives', 'superlative', 'superlatives', 'taller than', 'more than', 'as as', 'better or best', 'good better best'], a: 'Short adjectives: -er / -est (tall \u2192 taller \u2192 the tallest). Long adjectives: more / the most (more interesting \u2192 the most interesting). Irregular: good \u2192 better \u2192 the best, bad \u2192 worse \u2192 the worst, far \u2192 further \u2192 the furthest. Use than with comparatives: She is taller than me.' },
    { id: 'en_passive', lang: 'English', k: ['passive', 'passive voice', 'was written', 'is made', 'by whom'], a: 'Passive = be + past participle. Use it when the doer is unknown or unimportant: The window was broken. English is spoken worldwide. Add \u201cby ...\u201d only when it matters: The book was written by Orwell.' },
    { id: 'en_gerund', lang: 'English', k: ['gerund', 'infinitive', 'ing or to', 'enjoy doing', 'want to do', 'verb pattern', 'verb patterns', 'to do or doing', 'stop doing'], a: 'Some verbs take -ing (enjoy, avoid, finish, mind): I enjoy cooking. Others take to + infinitive (want, decide, hope, plan): I want to learn. A few change meaning: stop smoking (quit) vs stop to smoke (pause in order to smoke). Learn each new verb together with its pattern.' },
    { id: 'en_questions', lang: 'English', k: ['question form', 'forming questions', 'how to ask a question', 'question word order', 'do or does', 'did you', 'auxiliary'], a: 'Question order: question word + auxiliary + subject + main verb. Where do you live? What did she say? No \u201cdo\u201d with be or modals: Are you ready? Can you swim? Questions about the subject keep normal order: Who called you?' },
    { id: 'en_future', lang: 'English', k: ['future', 'will or going to', 'going to', 'will', 'future tense', 'future plans'], a: 'Will = instant decisions and predictions (I\'ll help you. It will rain). Going to = plans and things you can already see coming (I\'m going to study tonight. Look at those clouds - it\'s going to rain). Present continuous = fixed arrangements: I\'m meeting Tom at six.' },
    { id: 'en_used', lang: 'English', k: ['used to', 'be used to', 'get used to', 'accustomed', 'past habits'], a: 'Used to + infinitive = a past habit that no longer exists: I used to play chess. Be/get used to + -ing = to be or become accustomed: I\'m used to getting up early.' },
    { id: 'en_reported', lang: 'English', k: ['reported speech', 'indirect speech', 'said that', 'told me that', 'backshift'], a: 'In reported speech the tense usually moves one step back: \u201cI am tired\u201d \u2192 She said she was tired. \u201cI will come\u201d \u2192 He said he would come. Pronouns and time words change too: today \u2192 that day, tomorrow \u2192 the next day.' },
    { id: 'en_idioms', lang: 'English', k: ['idiom', 'idioms', 'expression', 'expressions', 'slang', 'phrase meaning', 'common sayings'], a: 'Some popular idioms:\n- break the ice = start a conversation\n- a piece of cake = very easy\n- once in a blue moon = very rarely\n- under the weather = slightly ill\n- hit the books = study hard\nUse an idiom only when you know it well - they do not translate word by word.' },
    { id: 'en_stress', lang: 'English', k: ['word stress', 'schwa', 'ed ending', 'ed endings', 'past tense pronunciation', 'how to pronounce ed', 'syllable'], a: 'The -ed ending has three sounds: /t/ after voiceless sounds (worked), /d/ after voiced sounds (played), /\u026ad/ after t or d (wanted). Also learn the stress of each new word: photograph, photographer, photographic all stress different syllables.' },
    { id: 'en_errors', lang: 'English', k: ['common errors', 'typical mistakes', 'common mistakes in english', 'i am agree', 'he don.t', 'discuss about', 'informations', 'make or do'], a: 'Typical errors and fixes:\n- I am agree \u2192 I agree\n- He don\'t like \u2192 He doesn\'t like\n- discuss about it \u2192 discuss it\n- informations \u2192 information (uncountable)\n- do a mistake \u2192 make a mistake; make homework \u2192 do homework' },
    { id: 'en_linking', lang: 'English', k: ['linking words', 'connectors', 'however', 'although', 'because or so', 'therefore', 'on the other hand', 'discourse markers'], a: 'Linking words: because/since (reason), so/therefore (result), but/however/although (contrast), and/also/moreover (addition), first/then/finally (order). Although + clause: Although it rained, we went out. However + comma: It rained. However, we went out.' },
    { id: 'en_saytell', lang: 'English', k: ['say or tell', 'say and tell', 'speak or talk', 'speak and talk', 'bring or take', 'borrow or lend'], a: 'Tell needs a person: tell me, tell her the truth. Say does not: say hello, say that you are ready. Speak = ability or a formal talk (speak English); talk = conversation (talk to a friend). Bring = towards the speaker; take = away from the speaker.' },
    { id: 'en_us_uk', lang: 'English', k: ['british or american', 'american english', 'british english', 'uk or us', 'colour or color', 'lift or elevator'], a: 'British vs American: colour/color, centre/center, flat/apartment, lift/elevator, autumn/fall, football/soccer. Both are correct - choose one and stay consistent in a text.' },

    /* ----- Japanese grammar ----- */
    { id: 'jp_adj', lang: 'Japanese', k: ['adjective', 'adjectives', 'i adjective', 'na adjective', 'i-adjective', 'na-adjective', 'takai', 'kirei'], a: 'Two kinds of adjectives: い-adjectives end in い (高い takai = expensive) and conjugate themselves: negative \u9ad8\u304f\u306a\u3044, past \u9ad8\u304b\u3063\u305f. な-adjectives (\u304d\u308c\u3044 kirei = pretty) need \u306a before a noun: \u304d\u308c\u3044\u306a\u4eba, and use \u3067\u3059 / \u3058\u3083\u306a\u3044. Exception: \u3044\u3044 (good) becomes \u3088\u304f\u306a\u3044, \u3088\u304b\u3063\u305f.' },
    { id: 'jp_neg', lang: 'Japanese', k: ['negative', 'negation', 'not', 'masen', 'nai form', 'say no', 'ません'], a: 'Negative: verbs \u307e\u3059 \u2192 \u307e\u305b\u3093 (\u98df\u3079\u307e\u3059 \u2192 \u98df\u3079\u307e\u305b\u3093); plain form \u98df\u3079\u308b \u2192 \u98df\u3079\u306a\u3044. Nouns and な-adjectives: \u3067\u306f\u3042\u308a\u307e\u305b\u3093 / \u3058\u3083\u306a\u3044\u3067\u3059 (\u5b66\u751f\u3058\u3083\u306a\u3044\u3067\u3059 = I\'m not a student).' },
    { id: 'jp_past', lang: 'Japanese', k: ['past tense', 'past', 'mashita', 'deshita', 'yesterday', 'ました', 'でした'], a: 'Past polite: \u307e\u3059 \u2192 \u307e\u3057\u305f (\u98df\u3079\u307e\u3057\u305f = ate); negative past \u307e\u305b\u3093\u3067\u3057\u305f. Nouns: \u3067\u3059 \u2192 \u3067\u3057\u305f. い-adjectives: \u9ad8\u304b\u3063\u305f. The plain past uses the \u305f-form, built like the te-form (\u98df\u3079\u305f, \u98f2\u3093\u3060, \u884c\u3063\u305f).' },
    { id: 'jp_tai', lang: 'Japanese', k: ['want to', 'tai form', 'tai', 'i want', 'たい', 'wish to do'], a: 'To say \u201cI want to do ...\u201d take the ます-stem + \u305f\u3044: \u884c\u304d\u305f\u3044 (I want to go), \u98df\u3079\u305f\u3044 (I want to eat). Negative: \u884c\u304d\u305f\u304f\u306a\u3044. For another person use \u305f\u304c\u3063\u3066\u3044\u308b: \u5f7c\u306f\u884c\u304d\u305f\u304c\u3063\u3066\u3044\u307e\u3059.' },
    { id: 'jp_q', lang: 'Japanese', k: ['question', 'questions', 'how to ask', 'question word', 'question words', 'nani', 'doko', 'dare', 'itsu', 'doushite', '何', '誰', 'どこ', 'いつ', 'なぜ'], a: 'Add \u304b to the end of a sentence to make a question: \u5b66\u751f\u3067\u3059\u304b? Question words: \u4f55 nani/nan (what), \u8ab0 dare (who), \u3069\u3053 doko (where), \u3044\u3064 itsu (when), \u3069\u3046\u3057\u3066 / \u306a\u305c (why), \u3044\u304f\u3089 ikura (how much), \u3069\u308c dore (which). The word order does not change.' },
    { id: 'jp_kosoado', lang: 'Japanese', k: ['kore sore are', 'kore', 'sore', 'are', 'this and that', 'demonstrative', 'demonstratives', 'kosoado', 'kono sono ano', 'これ', 'それ', 'あれ', 'ここ'], a: 'Ko-so-a-do words: \u3053\u308c (this, near me), \u305d\u308c (that, near you), \u3042\u308c (that over there), \u3069\u308c (which). Places: \u3053\u3053 / \u305d\u3053 / \u3042\u305d\u3053 / \u3069\u3053. Before a noun: \u3053\u306e / \u305d\u306e / \u3042\u306e / \u3069\u306e + noun (\u3053\u306e\u672c = this book).' },
    { id: 'jp_exist', lang: 'Japanese', k: ['arimasu', 'imasu', 'there is', 'there are', 'exist', 'aru or iru', 'あります', 'います'], a: '\u3042\u308a\u307e\u3059 is for things that do not move by themselves (\u672c\u304c\u3042\u308a\u307e\u3059 = there is a book). \u3044\u307e\u3059 is for people and animals (\u732b\u304c\u3044\u307e\u3059 = there is a cat). The location comes first with \u306b: \u673a\u306e\u4e0a\u306b\u672c\u304c\u3042\u308a\u307e\u3059.' },
    { id: 'jp_end', lang: 'Japanese', k: ['ne and yo', 'sentence ending', 'sentence endings', 'ending particles', 'yo', 'ね', 'よ', 'ending ne'], a: 'Sentence-ending particles: \u306d asks for agreement (\u3044\u3044\u5929\u6c17\u3067\u3059\u306d = nice weather, isn\'t it?); \u3088 gives information the listener may not know (\u3053\u308c\u306f\u304a\u3044\u3057\u3044\u3067\u3059\u3088 = this is delicious, you know).' },
    { id: 'jp_dakuten', lang: 'Japanese', k: ['dakuten', 'handakuten', 'tenten', 'voiced', 'ten ten', '\u309b', 'small circle'], a: 'Two small marks change the sound: dakuten (\u3099) voices it - \u304b \u2192 \u304c, \u3055 \u2192 \u3056, \u305f \u2192 \u3060, \u306f \u2192 \u3070. Handakuten (\u309a) turns the h-row into p: \u306f \u2192 \u3071. The same works in katakana: \u30ab \u2192 \u30ac, \u30cf \u2192 \u30d1.' },
    { id: 'jp_learn_kana', lang: 'Japanese', k: ['learn hiragana', 'learn katakana', 'order of kana', 'memorize hiragana', 'memorise hiragana', 'kana chart', 'learn kana', 'how to learn hiragana'], a: 'Learn kana in rows: vowels \u3042\u3044\u3046\u3048\u304a first, then \u304b-row, \u3055-row and so on - about 5 characters a day. Write each one while saying it, link it to a picture, and quiz yourself on a mixed order. Hiragana takes most learners one to two weeks; katakana is faster afterwards.' },
    { id: 'jp_kanji_mem', lang: 'Japanese', k: ['remember kanji', 'memorize kanji', 'memorise kanji', 'kanji trick', 'kanji mnemonic', 'learn kanji', 'kanji memory', 'kanji tips'], a: 'Kanji are built from parts, so use stories: \u4f11 = person \u4eba beside a tree \u6728 = rest; \u660e = sun \u65e5 + moon \u6708 = bright; \u6797 = two trees = woods, \u68ee = three trees = forest. Learn each kanji inside a word and write it a few times.' },
    { id: 'jp_input', lang: 'Japanese', k: ['keyboard', 'type japanese', 'typing', 'ime', 'input method', 'install japanese', 'write japanese on computer', 'japanese keyboard'], a: 'To type Japanese add the Japanese keyboard/IME in your system settings (Windows, macOS, Android and iOS all have one). Type in romaji (konnichiwa) and the IME turns it into \u3053\u3093\u306b\u3061\u306f; press Space to choose kanji and Enter to confirm.' },

    /* ----- Italian grammar ----- */
    { id: 'it_present', lang: 'Italian', k: ['present tense', 'regular verbs', 'are verbs', 'ere verbs', 'ire verbs', 'conjugate parlare', 'presente', 'verb endings'], a: 'Present tense endings. -are (parlare): parlo, parli, parla, parliamo, parlate, parlano. -ere (vendere): vendo, vendi, vende, vendiamo, vendete, vendono. -ire (dormire): dormo, dormi, dorme, dormiamo, dormite, dormono. Some -ire verbs add -isc-: finisco, finisci, finisce, finiamo, finite, finiscono.' },
    { id: 'it_neg', lang: 'Italian', k: ['negative', 'negation', 'non', 'say no', 'nessuno', 'niente', 'mai', 'double negative'], a: 'Put non before the verb: Non parlo italiano. With nessuno, niente, mai after the verb you keep non as well (double negative is correct): Non vedo nessuno. Non ho niente. Non vado mai al cinema.' },
    { id: 'it_q', lang: 'Italian', k: ['question words', 'ask a question', 'how to ask', 'chi', 'dove', 'quando', 'perche', 'perch\u00e9', 'come', 'quanto', 'quale', 'cosa'], a: 'Question words: chi (who), che / cosa (what), dove (where), quando (when), perch\u00e9 (why / because), come (how), quanto / quanti (how much / many), quale (which). A yes/no question needs no change of word order - just rising intonation: Parli italiano?' },
    { id: 'it_poss', lang: 'Italian', k: ['possessive', 'possessives', 'mio', 'tuo', 'suo', 'my and your', 'il mio', 'la mia', 'possessivi'], a: 'Possessives usually take the article and agree with the thing owned: il mio libro, la mia casa, i miei amici, le mie amiche. Exception: singular family members have no article (mia madre, mio fratello), but plurals do (i miei fratelli). Loro always keeps it: la loro casa.' },
    { id: 'it_prep', lang: 'Italian', k: ['prepositions', 'preposition', 'a or in', 'da', 'di', 'su', 'per', 'con', 'a roma', 'in italia', 'in or a'], a: 'Use a with cities (vado a Roma), in with countries and regions (vivo in Italia), da for coming from or going to someone\'s place (vengo da Milano, vado dal dentista), di for possession and origin (il libro di Marco), con for \u201cwith\u201d, per for purpose and destination, su for \u201con\u201d.' },
    { id: 'it_piacere', lang: 'Italian', k: ['piacere', 'mi piace', 'mi piacciono', 'to like', 'i like', 'liking', 'piace'], a: 'Piacere works backwards: the thing liked is the subject. Mi piace il gelato (I like ice cream - singular). Mi piacciono i film (plural). With a verb, use piace: Mi piace leggere. Negative: Non mi piace il caff\u00e8. For \u201cto you\u201d: Ti piace? For \u201cto him/her\u201d: Gli / Le piace.' },
    { id: 'it_reflex', lang: 'Italian', k: ['reflexive', 'reflexive verbs', 'alzarsi', 'lavarsi', 'mi lavo', 'daily routine', 'routine verbs', 'svegliarsi'], a: 'Reflexive verbs use mi, ti, si, ci, vi, si: lavarsi \u2192 mi lavo, ti lavi, si lava, ci laviamo, vi lavate, si lavano. Daily routine: mi sveglio alle sette, mi alzo, mi vesto, faccio colazione.' },
    { id: 'it_future', lang: 'Italian', k: ['future', 'futuro', 'future tense', 'will', 'parler\u00f2', 'sar\u00f2', 'avr\u00f2', 'tomorrow i will'], a: 'Future: replace the -e of the infinitive with the endings -\u00f2, -ai, -\u00e0, -emo, -ete, -anno and change -are to -er-: parlare \u2192 parler\u00f2, parlerai, parler\u00e0... Irregulars: essere \u2192 sar\u00f2, avere \u2192 avr\u00f2, andare \u2192 andr\u00f2, fare \u2192 far\u00f2. For the near future Italians often just use the present: Domani vado a Roma.' },
    { id: 'it_cond', lang: 'Italian', k: ['condizionale', 'conditional', 'vorrei', 'i would like', 'would', 'polite request', 'potrei'], a: 'The condizionale makes requests polite: Vorrei un caff\u00e8 (I would like a coffee), Potrei avere il conto? (could I have the bill?), Mi piacerebbe viaggiare (I would love to travel). Use vorrei instead of voglio when ordering.' },
    { id: 'it_numbers', lang: 'Italian', k: ['numbers over ten', 'eleven', 'twenty', 'hundred', 'venti', 'trenta', 'cento', 'higher numbers', 'big numbers'], a: '11 undici, 12 dodici, 13 tredici, 14 quattordici, 15 quindici, 16 sedici, 17 diciassette, 18 diciotto, 19 diciannove, 20 venti, 30 trenta, 40 quaranta, 50 cinquanta, 100 cento. Numbers ending in 1 or 8 drop the vowel: ventuno, ventotto.' },
    { id: 'it_accents', lang: 'Italian', k: ['accent marks', 'accents', 'type accents', 'type italian', 'italian keyboard', 'grave', 'acute', '\u00e8 or e'], a: 'The accent shows stress and meaning: \u00e8 (is) vs e (and), l\u00e0 (there) vs la (the). Final stressed vowels are written with an accent: citt\u00e0, caff\u00e8, perch\u00e9. On a phone hold the letter to pick \u00e0 \u00e8 \u00e9 \u00ec \u00f2 \u00f9; on a computer add the Italian or United States-International keyboard layout.' },
    { id: 'it_gestures', lang: 'Italian', k: ['gestures', 'hand gestures', 'italian culture', 'culture', 'etiquette', 'customs'], a: 'Italians use many gestures, from a pinched hand for \u201cwhat do you want?\u201d to a hand on the heart for \u201cthank you\u201d. Culture tip: greet with Buongiorno when entering a shop, and note that cappuccino is traditionally a morning drink.' }
  ];
  KB = KB.concat(KB2);

  var FILLER = /\b(what|does|do|is|are|mean|means|meaning|of|how|you|use|used|explain|the|this|that|a|an|tell|me|about|word|phrase|in|say|please)\b|[?!.,"\u201c\u201d]/g;

  function bestEntry(text, ctx) {
    var best = null, bs = 0;
    KB.forEach(function (e) {
      if (e.lang && e.lang !== ctx.lang) return;
      var s = score(text, e.k); if (!s) return;
      if (e.lang) s += 0.6;                       // language-specific answers win ties
      if (e.w) s += e.w;                          // phrasebook entries beat generic keywords
      if (s > bs) { bs = s; best = e; }
    });
    return best && { e: best, s: bs };
  }

  /* finds the lesson row a message is about. strong = matched the first column; weak = matched an example or note */
  function lookupTerm(text, ctx) {
    if (!ctx.rows || !ctx.rows.length || text.length > 70) return null;
    var core = text.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
    var cjk = /[^\x00-\x7f]/.test(core);
    if (core.length < 2 && !cjk) return null;
    var strong = null, weak = null;
    ctx.rows.forEach(function (r) {
      var a = r[0].toLowerCase();
      if (!strong && (((a.length >= 2 || /[^\x00-\x7f]/.test(a)) && text.indexOf(a) !== -1) || ((core.length >= 3 || cjk) && a.indexOf(core) !== -1) || (core.length >= 3 && (r[1] || '').toLowerCase() === core))) strong = r;
      if (!weak && core.length >= 5 && r.slice(1).some(function (c) { return c.toLowerCase().indexOf(core) !== -1; })) weak = r;
    });
    return strong ? { row: strong, strong: true } : weak ? { row: weak, strong: false } : null;
  }

  function reply(ctx, msgs) {
    ctx = ctx || {}; ctx.rows = ctx.rows || []; ctx.head = ctx.head || []; ctx.notes = ctx.notes || []; ctx.titles = ctx.titles || []; ctx.name = ctx.name || 'this';
    var last = (msgs && msgs.length ? msgs[msgs.length - 1].content : '') || '';
    var text = last.toLowerCase().replace(/[\u2019']/g, '.').trim();
    var prev = msgs && msgs.length > 1 ? msgs[msgs.length - 2].content : '';

    // 1. answering a quiz question the tutor just asked
    var asked = /Quiz: .*?\u201c(.+?)\u201d/.exec(prev || '');
    if (asked && !/^(quiz|another|next)/.test(text)) {
      var row = ctx.rows.filter(function (r) { return r[0] === asked[1]; })[0];
      if (row) {
        var c = ansCol(ctx), ans = (row[c] || '').toLowerCase(), words = ans.match(/[a-z\u00c0-\u017f]{4,}/g) || [];
        var ok = words.some(function (w) { return text.indexOf(w) !== -1; }) || (text.length >= 3 && ans.indexOf(text) !== -1);
        return { reply: (ok ? 'Correct! ' : 'Not quite. ') + rowLine(ctx, row) + '\nWant another one?', suggest: ['Another quiz question', 'Explain this lesson simply'] };
      }
    }
    if (/^(another|next|again|one more)/.test(text) && /Quiz: /.test(prev || '')) return { reply: dyn.quiz(ctx), suggest: ['Explain this lesson simply'] };

    var hit = bestEntry(text, ctx), term = lookupTerm(text, ctx);

    // 2. a word from the lesson on screen
    if (term && (!hit || (term.strong && hit.s < 2) || hit.e.id === 'greet' || hit.e.id === 'translate')) {
      return { reply: rowLine(ctx, term.row) + (ctx.notes[0] ? '\nTip: ' + ctx.notes[0] : ''), suggest: ['Quiz me on it', 'Show the practice task'] };
    }
    // 3. predetermined answer chosen by keywords
    if (hit) {
      var a = typeof hit.e.a === 'function' ? hit.e.a(ctx) : hit.e.a;
      return { reply: a, suggest: hit.e.s || DEFAULT_SUGGEST.slice(0, 3) };
    }
    // 4. nothing matched
    return { reply: 'I am not sure about that one. I answer best about this ' + (ctx.lesson ? 'lesson' : 'course') + ', study tips, pronunciation, and how coins, chests and the shop work. You can also type a word from the lesson and I will explain it. Try one of these:', suggest: DEFAULT_SUGGEST };
  }

  return { reply: reply, kbSize: function () { return KB.length; } };
});
