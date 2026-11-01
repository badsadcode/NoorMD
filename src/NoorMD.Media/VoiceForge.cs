namespace NoorMD.Media;

/// <summary>
/// Voice Forge: voices made from nothing (no recordings, no downloaded models). A small formant synthesizer: a buzz from
/// the "vocal cords" (a glottal pulse, with breath, rasp, creak and growl) goes through resonators that are the mouth
/// and throat (the formants that make vowels), plus bands of noise for s, sh, f and the like, bursts for p, t, k, a
/// trill for rr and clicks. A planner turns what is said (chatter, a question, a laugh, a scream…), in what language
/// style, with what emotion and delivery, into syllables with timing, loudness and a pitch contour.
/// It is stylized on purpose: cartoon, creature and NPC voices, not a person's voice.
/// <para>The same settings give the same sound. The language's words come from its own seed (LanguageSeed), so one
/// character keeps one language; the take (word choice, timing, small variations) from the recipe's seed.</para>
/// </summary>
public static partial class VoiceForge
{
    public sealed record Choice(string Id, string Name, string Group = "");

    /// <summary>What the voice says: speech of a kind, or a sound with no words.</summary>
    public static readonly IReadOnlyList<Choice> Says =
    [
        new("chatter", "Chatter (talking)", "Speech"), new("greeting", "A greeting", "Speech"), new("question", "Questions", "Speech"),
        new("command", "Commands", "Speech"), new("argument", "Arguing", "Speech"), new("complaint", "Complaining", "Speech"),
        new("warning", "A warning", "Speech"), new("mutter", "Muttering", "Speech"), new("celebration", "Celebrating", "Speech"),
        new("chant", "Chanting", "Speech"),
        new("laugh", "Laugh", "Sounds"), new("giggle", "Giggle", "Sounds"), new("chuckle", "Chuckle", "Sounds"), new("cry", "Crying", "Sounds"),
        new("scream", "Scream", "Sounds"), new("yelp", "Yelp / ouch", "Sounds"), new("grunt", "Grunt (effort, pain)", "Sounds"),
        new("groan", "Groan", "Sounds"), new("sigh", "Sigh", "Sounds"), new("gasp", "Gasp", "Sounds"), new("growl", "Growl", "Sounds"),
        new("pant", "Panting", "Sounds"), new("cheer", "Cheer", "Sounds"), new("hmm", "Hmm (thinking)", "Sounds"),
    ];

    public static readonly IReadOnlyList<Choice> Emotions =
    [
        new("calm", "calm"), new("happy", "happy"), new("excited", "excited"), new("curious", "curious"), new("surprised", "surprised"),
        new("sad", "sad"), new("tired", "tired"), new("shy", "shy"), new("afraid", "afraid"), new("annoyed", "annoyed"),
        new("angry", "angry"), new("furious", "furious"), new("disgusted", "disgusted"), new("sarcastic", "sarcastic"),
    ];

    public static readonly IReadOnlyList<Choice> Deliveries =
    [
        new("normal", "normal"), new("whisper", "whisper"), new("shout", "shout"), new("mumble", "mumble"), new("singsong", "sing-song"),
        new("robotic", "robotic"), new("breathless", "breathless"), new("stutter", "hesitant / stuttering"),
    ];

    public static readonly IReadOnlyList<Choice> Languages =
    [
        new("common", "common (balanced)"), new("soft", "soft (flowing, m, n, l)"), new("harsh", "harsh (k, g, rr, kh)"),
        new("chirpy", "chirpy (quick, i, t, s)"), new("rumbly", "rumbly (deep o, u, b, g)"), new("bubbly", "bubbly (b, p, repeats)"),
        new("clicky", "clicky (clicks, stops)"), new("melodic", "melodic (open, long vowels)"),
    ];

    /// <summary>A reusable voice: who is speaking (pitch, size, breath, rasp…) and how they usually talk.</summary>
    public sealed record VoiceProfile(string Name, double Pitch, double Range, double Size, double Breath, double Rasp, double Nasal,
        double Creature, double Clarity, double Rate, string Language = "common", string Delivery = "normal");

    public static readonly IReadOnlyList<VoiceProfile> Profiles =
    [
        new("Adult, low", 105, 6, 1.08, 0.1, 0.1, 0.1, 0, 0.7, 4.8),
        new("Adult, high", 205, 8, 0.86, 0.15, 0.05, 0.1, 0, 0.7, 5.2),
        new("Narrator", 118, 5, 1.02, 0.08, 0.05, 0.05, 0, 0.85, 4.4),
        new("Cartoon kid", 310, 11, 0.7, 0.15, 0, 0.2, 0, 0.6, 6.2, "bubbly"),
        new("Elder", 135, 4, 1.0, 0.35, 0.4, 0.15, 0, 0.55, 3.8, "soft"),
        new("Goblin", 235, 9, 0.74, 0.1, 0.35, 0.6, 0.2, 0.7, 7, "harsh"),
        new("Brute", 78, 5, 1.35, 0.1, 0.55, 0.2, 0.4, 0.5, 3.6, "rumbly"),
        new("Giant", 58, 4, 1.7, 0.15, 0.3, 0.1, 0.3, 0.5, 2.8, "rumbly"),
        new("Fairy", 480, 12, 0.6, 0.4, 0, 0.15, 0, 0.6, 7.5, "chirpy"),
        new("Critter", 620, 10, 0.5, 0.1, 0.1, 0.3, 0.1, 0.5, 9, "chirpy"),
        new("Alien", 260, 9, 0.8, 0.1, 0.1, 0.35, 0.55, 0.8, 6, "clicky"),
        new("Robot", 120, 4, 1.0, 0, 0, 0.1, 0.2, 0.95, 5, "common", "robotic"),
        new("Ghost", 190, 7, 0.95, 0.75, 0.1, 0.1, 0, 0.5, 3.5, "soft", "whisper"),
        new("Monster", 55, 6, 1.5, 0.2, 0.8, 0.15, 0.9, 0.45, 3.2, "rumbly"),
    ];

    /// <summary>Puts a profile's identity on a voice layer (what it says and how stays as it is).</summary>
    public static void Apply(VoiceProfile p, SoundLayer l)
    {
        l.Pitch = p.Pitch; l.VoiceRange = p.Range; l.VoiceSize = p.Size; l.Breath = p.Breath; l.Rasp = p.Rasp; l.Nasal = p.Nasal;
        l.Creature = p.Creature; l.Clarity = p.Clarity; l.SyllableRate = p.Rate; l.Language = p.Language; l.Delivery = p.Delivery; l.VoiceProfile = p.Name;
    }

    // ---------------------------------------------------------------- phonemes

    private enum K { Vowel, Stop, Fric, Nasal, Liquid, Trill, Aspirate, Glottal, Click }

    private sealed record Ph(string Sym, K Kind, bool Voiced, double F1, double F2, double F3, double NoiseF = 0, double NoiseBw = 0, double NoiseAmp = 0, double BurstF = 0);

    private static readonly Dictionary<string, Ph> Phones = new Ph[]
    {
        new("a", K.Vowel, true, 750, 1220, 2600), new("e", K.Vowel, true, 480, 1900, 2550), new("i", K.Vowel, true, 300, 2250, 3000),
        new("o", K.Vowel, true, 500, 880, 2500), new("u", K.Vowel, true, 330, 800, 2300), new("@", K.Vowel, true, 520, 1450, 2500),
        new("ae", K.Vowel, true, 660, 1700, 2450),
        new("p", K.Stop, false, 250, 900, 2200, BurstF: 900), new("b", K.Stop, true, 250, 900, 2200, BurstF: 900),
        new("t", K.Stop, false, 300, 1700, 2600, BurstF: 4000), new("d", K.Stop, true, 300, 1700, 2600, BurstF: 3500),
        new("k", K.Stop, false, 280, 1900, 2400, BurstF: 1800), new("g", K.Stop, true, 280, 1900, 2400, BurstF: 1800),
        new("s", K.Fric, false, 300, 1700, 2600, 6500, 2500, 0.45), new("z", K.Fric, true, 300, 1700, 2600, 6500, 2500, 0.3),
        new("sh", K.Fric, false, 300, 1900, 2400, 3000, 1600, 0.5), new("zh", K.Fric, true, 300, 1900, 2400, 3000, 1600, 0.35),
        new("f", K.Fric, false, 300, 1100, 2400, 5000, 6000, 0.14), new("v", K.Fric, true, 300, 1100, 2400, 5000, 6000, 0.1),
        new("x", K.Fric, false, 300, 1500, 2400, 1700, 1200, 0.4), new("th", K.Fric, false, 300, 1500, 2600, 6000, 5000, 0.12),
        new("m", K.Nasal, true, 250, 1000, 2200), new("n", K.Nasal, true, 250, 1500, 2600), new("ng", K.Nasal, true, 250, 2000, 2400),
        new("l", K.Liquid, true, 360, 1300, 2900), new("r", K.Liquid, true, 420, 1250, 1700), new("w", K.Liquid, true, 300, 700, 2200),
        new("y", K.Liquid, true, 280, 2200, 3000), new("rr", K.Trill, true, 420, 1300, 1800),
        new("h", K.Aspirate, false, 0, 0, 0), new("'", K.Glottal, false, 0, 0, 0), new("!", K.Click, false, 0, 0, 0, BurstF: 2200),
    }.ToDictionary(p => p.Sym);

    /// <summary>A language style: its sounds and how they make syllables and words.</summary>
    private sealed record LangStyle(string[] Vowels, string[] Onsets, string[] Codas, double V, double CV, double CVC, double CCV, int MinSyl, int MaxSyl, bool StressLast = false, double Redup = 0, double LongVowel = 0);

    private static LangStyle Style(string id) => id switch
    {
        "soft" => new(["a", "a", "o", "u", "e", "i"], ["m", "n", "l", "w", "y", "h", "v", "l", "m"], ["n", "m", "l"], 0.2, 0.65, 0.15, 0, 2, 3, LongVowel: 0.2),
        "harsh" => new(["a", "o", "u", "@", "a"], ["k", "g", "x", "rr", "d", "t", "z", "sh", "k", "g", "gr", "kr", "dr"], ["k", "g", "x", "rr", "t", "sh", "k"], 0.05, 0.4, 0.5, 0.05, 1, 2),
        "chirpy" => new(["i", "e", "i", "a", "e"], ["t", "p", "k", "s", "ch", "y", "t", "ts"], ["t", "k", "s"], 0.1, 0.7, 0.2, 0, 1, 2),
        "rumbly" => new(["o", "u", "a", "@", "o"], ["b", "d", "g", "m", "n", "v", "r", "b", "g"], ["m", "n", "r", "g", "m"], 0.1, 0.5, 0.4, 0, 1, 2, LongVowel: 0.3),
        "bubbly" => new(["o", "u", "a", "i", "u"], ["b", "p", "m", "w", "l", "b"], ["b", "p", "m"], 0.1, 0.8, 0.1, 0, 2, 3, Redup: 0.45),
        "clicky" => new(["a", "i", "u", "a"], ["!", "k", "t", "'", "n", "!", "x"], ["'", "k", "!"], 0.15, 0.55, 0.3, 0, 1, 3, StressLast: true),
        "melodic" => new(["a", "e", "i", "o", "a", "o"], ["l", "n", "m", "r", "s", "l", "v", "d"], ["n", "l"], 0.15, 0.75, 0.1, 0, 2, 4, StressLast: true, LongVowel: 0.35),
        _ => new(["a", "a", "e", "i", "o", "u", "@"], ["b", "d", "g", "k", "t", "p", "m", "n", "l", "r", "s", "h", "v", "z", "w", "y", "br", "tr", "kl", "st", "sh", "f"], ["n", "m", "r", "l", "s", "k", "t"], 0.1, 0.5, 0.3, 0.1, 1, 3),
    };

    // A syllable: its sounds, in order.
    private sealed record Syl(string[] Onset, string Vowel, string[] Coda, bool Long);

    private static string[] Split(string cluster) => cluster switch
    {
        "ch" => ["t", "sh"], "ts" => ["t", "s"], "gr" => ["g", "rr"], "kr" => ["k", "rr"], "dr" => ["d", "r"], "br" => ["b", "r"], "tr" => ["t", "r"],
        "kl" => ["k", "l"], "st" => ["s", "t"], _ => [cluster],
    };

    private static List<Syl> MakeWord(LangStyle s, SoundRng rng)
    {
        T Pick<T>(T[] a) => a[(int)(rng.NextDouble() * a.Length) % a.Length];
        var n = s.MinSyl + (int)(rng.NextDouble() * (s.MaxSyl - s.MinSyl + 1));
        var word = new List<Syl>();
        for (var k = 0; k < n; k++)
        {
            if (word.Count > 0 && rng.NextDouble() < s.Redup) { word.Add(word[^1]); continue; } // bubu, tata
            var x = rng.NextDouble() * (s.V + s.CV + s.CVC + s.CCV);
            string[] onset = x < s.V && k > 0 ? [] : Split(Pick(s.Onsets));
            if (x >= s.V + s.CV + s.CVC && onset.Length == 1 && Phones[onset[0]].Kind is K.Stop or K.Fric) onset = [onset[0], Pick(["r", "l"])];
            string[] coda = x >= s.V + s.CV && x < s.V + s.CV + s.CVC ? Split(Pick(s.Codas)) : [];
            word.Add(new Syl(onset, Pick(s.Vowels), coda, rng.NextDouble() < s.LongVowel));
        }
        return word;
    }

    // ---------------------------------------------------------------- performance (emotion, delivery)

    /// <summary>How an emotion changes speech: pitch shift (semitones), range ×, speed ×, effort, breath, tremor, creak,
    /// pauses ×, loudness, rasp, nasal, vowel length ×.</summary>
    private sealed record Feel(double Shift, double Range, double Rate, double Effort, double Breath, double Tremor, double Creak, double Pause, double Loud, double Rasp = 0, double Nasal = 0, double Drawl = 1)
    {
        public static Feel Lerp(Feel a, Feel b, double t) => new(a.Shift + (b.Shift - a.Shift) * t, a.Range + (b.Range - a.Range) * t, a.Rate + (b.Rate - a.Rate) * t,
            a.Effort + (b.Effort - a.Effort) * t, a.Breath + (b.Breath - a.Breath) * t, a.Tremor + (b.Tremor - a.Tremor) * t, a.Creak + (b.Creak - a.Creak) * t,
            a.Pause + (b.Pause - a.Pause) * t, a.Loud + (b.Loud - a.Loud) * t, a.Rasp + (b.Rasp - a.Rasp) * t, a.Nasal + (b.Nasal - a.Nasal) * t, a.Drawl + (b.Drawl - a.Drawl) * t);
    }

    private static readonly Feel Neutral = new(0, 1, 1, 0.5, 0, 0, 0, 1, 0.85);

    private static Feel EmotionFeel(string id) => id switch
    {
        "happy" => new(3, 1.4, 1.1, 0.6, 0.05, 0, 0, 0.8, 1),
        "excited" => new(5, 1.7, 1.3, 0.8, 0.05, 0, 0, 0.55, 1.1),
        "curious" => new(2, 1.25, 1, 0.5, 0.05, 0, 0, 0.9, 0.9),
        "surprised" => new(5, 1.8, 1.05, 0.7, 0.1, 0, 0, 0.8, 1.05),
        "sad" => new(-3, 0.5, 0.75, 0.25, 0.25, 0.25, 0.2, 1.5, 0.6, Drawl: 1.25),
        "tired" => new(-3, 0.4, 0.7, 0.2, 0.3, 0, 0.55, 1.6, 0.6, Drawl: 1.3),
        "shy" => new(1, 0.6, 0.85, 0.25, 0.3, 0.1, 0, 1.3, 0.55),
        "afraid" => new(4, 1.2, 1.3, 0.6, 0.3, 0.6, 0, 0.9, 0.9),
        "annoyed" => new(1, 1.1, 1.05, 0.75, 0.05, 0, 0.15, 0.85, 1, 0.15),
        "angry" => new(2, 1.35, 1.15, 0.95, 0, 0, 0.1, 0.7, 1.4, 0.3),
        "furious" => new(6, 1.6, 1.25, 1, 0.05, 0.1, 0, 0.5, 1.7, 0.6),
        "disgusted" => new(-1, 0.9, 0.85, 0.5, 0.1, 0, 0.3, 1.1, 0.85, 0.1, 0.35, 1.2),
        "sarcastic" => new(0, 1.5, 0.85, 0.5, 0.05, 0, 0.1, 1.1, 0.9, Drawl: 1.4),
        _ => Neutral,
    };

    /// <summary>Everything that shapes one utterance, from the layer's settings.</summary>
    private sealed class Plan
    {
        public readonly List<Seg> Segs = [];
        public readonly List<(double T, double St)> Pitch = [];
        public readonly List<string> Words = []; // what was said, for tests (each word's sounds)
        public double Time;
        public void Add(Seg s) { s.T0 = Time; Segs.Add(s); Time += s.Dur; }
        public void Point(double st, double at = -1) => Pitch.Add((at < 0 ? Time : at, st));
    }

    /// <summary>One stretch of sound with steady targets (the synthesizer glides between them).</summary>
    private sealed class Seg
    {
        public double T0, Dur;
        public double Voice, Asp, Fric, FricF, FricBw, F1, F2, F3, Nas, Trill, Burst, BurstF, Click, Amp = 1, Inhale;
        public Seg Clone() => (Seg)MemberwiseClone();
    }

    // ---------------------------------------------------------------- planning speech

    private static double[] VowelF(string v) { var p = Phones[v]; return [p.F1, p.F2, p.F3]; }

    /// <summary>The segments of one syllable; its vowel's start time is returned (for the pitch).</summary>
    private static double AddSyllable(Plan plan, Syl s, double vowelDur, double consDur, double amp, bool final)
    {
        var vf = VowelF(s.Vowel);
        foreach (var c in s.Onset) AddConsonant(plan, c, consDur, amp, vf);
        var vStart = plan.Time;
        plan.Add(new Seg { Dur = vowelDur * (s.Long ? 1.6 : 1), Voice = 1, F1 = vf[0], F2 = vf[1], F3 = vf[2], Amp = amp });
        foreach (var c in s.Coda) AddConsonant(plan, c, consDur * (final ? 1.3 : 1), amp * 0.85, vf);
        return vStart;
    }

    private static void AddConsonant(Plan plan, string sym, double d, double amp, double[] vowelF)
    {
        var p = Phones[sym];
        switch (p.Kind)
        {
            case K.Stop:
                plan.Add(new Seg { Dur = d * 0.55, Voice = p.Voiced ? 0.12 : 0, F1 = p.F1, F2 = p.F2, F3 = p.F3, Amp = amp });
                plan.Add(new Seg { Dur = p.Voiced ? d * 0.15 : d * 0.45, Voice = p.Voiced ? 0.6 : 0, Asp = p.Voiced ? 0 : 0.55, Burst = p.Voiced ? 0.18 : 0.3, BurstF = p.BurstF,
                    F1 = (p.F1 + vowelF[0]) / 2, F2 = (p.F2 + vowelF[1]) / 2, F3 = (p.F3 + vowelF[2]) / 2, Amp = amp });
                break;
            case K.Fric:
                plan.Add(new Seg { Dur = d * 1.1, Voice = p.Voiced ? 0.45 : 0, Fric = p.NoiseAmp, FricF = p.NoiseF, FricBw = p.NoiseBw, F1 = p.F1, F2 = p.F2, F3 = p.F3, Amp = amp, Asp = sym == "x" ? 0.15 : 0 });
                break;
            case K.Nasal:
                plan.Add(new Seg { Dur = d, Voice = 0.55, Nas = 1, F1 = p.F1, F2 = p.F2, F3 = p.F3, Amp = amp });
                break;
            case K.Liquid:
                plan.Add(new Seg { Dur = d * 0.8, Voice = 0.8, F1 = p.F1, F2 = p.F2, F3 = p.F3, Amp = amp });
                break;
            case K.Trill:
                plan.Add(new Seg { Dur = d * 1.3, Voice = 0.75, Trill = 1, F1 = p.F1, F2 = p.F2, F3 = p.F3, Amp = amp });
                break;
            case K.Aspirate:
                plan.Add(new Seg { Dur = d * 0.9, Asp = 0.6, F1 = vowelF[0], F2 = vowelF[1], F3 = vowelF[2], Amp = amp });
                break;
            case K.Glottal:
                plan.Add(new Seg { Dur = d * 0.6, F1 = vowelF[0], F2 = vowelF[1], F3 = vowelF[2], Amp = amp });
                break;
            case K.Click:
                plan.Add(new Seg { Dur = d * 0.4, Click = 1, BurstF = p.BurstF, F1 = vowelF[0], F2 = vowelF[1], F3 = vowelF[2], Amp = amp });
                plan.Add(new Seg { Dur = d * 0.3, F1 = vowelF[0], F2 = vowelF[1], F3 = vowelF[2], Amp = amp });
                break;
        }
    }

    private static void AddPause(Plan plan, double d, bool breath = false)
    {
        if (breath && d > 0.25)
        {
            plan.Add(new Seg { Dur = d * 0.35 });
            plan.Add(new Seg { Dur = d * 0.4, Asp = 0.25, Inhale = 1, F1 = 400, F2 = 1700, F3 = 2600, Amp = 0.5 });
            plan.Add(new Seg { Dur = d * 0.25 });
        }
        else plan.Add(new Seg { Dur = d });
    }

    /// <summary>Speech: phrases of words in the language, with stress, phrase-final lengthening and a pitch contour.</summary>
    /// <summary>
    /// Picks words of the layer's language: its own words (from its seed: the same seed, the same words, in every take
    /// and every line; common ones more often, as in a real language), or new ones as often as Consistency allows.
    /// </summary>
    private static Func<List<Syl>> WordPicker(SoundLayer l, SoundRng rng)
    {
        var style = Style(l.Language);
        // (Hashed first: seeds next to each other must not give the same stream one step apart.)
        var lrng = new SoundRng(new SoundRng(((ulong)(uint)l.LanguageSeed << 20) ^ Hash(l.Language)).Next());
        var vocab = Enumerable.Range(0, 48).Select(_ => MakeWord(style, lrng)).ToList();
        return () =>
        {
            if (rng.NextDouble() < l.Consistency) return vocab[(int)(Math.Pow(rng.NextDouble(), 2.2) * vocab.Count) % vocab.Count];
            return MakeWord(style, rng);
        };
    }

    private static void PlanSpeech(SoundLayer l, SoundRng rng, Plan plan, Func<double, Feel> feel)
    {
        var style = Style(l.Language);
        var Word = WordPicker(l, rng);
        var says = l.VoiceSays;
        var total = l.VoiceLength;
        var robotic = l.Delivery == "robotic";
        double[] scale = [0, 2, 4, 7, 9, 12, 14];
        var chantWords = says == "chant" ? Enumerable.Range(0, 2 + (int)(rng.NextDouble() * 2)).Select(_ => Word()).ToList() : null;
        var phraseIndex = 0;
        while (plan.Time < total * 0.97)
        {
            var f = feel(plan.Time / Math.Max(0.05, total));
            var rate = l.SyllableRate * f.Rate * (l.Delivery == "mumble" ? 0.9 : l.Delivery == "breathless" ? 1.1 : 1) * (says is "argument" ? 1.15 : says is "mutter" ? 0.9 : says is "chant" ? 0.85 : 1);
            var syl = 1 / rate;
            var range = l.VoiceRange * f.Range * (says is "mutter" ? 0.4 : says is "argument" or "celebration" ? 1.3 : 1) * (l.Delivery == "mumble" ? 0.5 : l.Delivery == "whisper" ? 0.6 : 1);
            var words = says switch
            {
                "greeting" => 1 + (int)(rng.NextDouble() * 2),
                "command" or "warning" => 1 + (int)(rng.NextDouble() * 3),
                "chant" => chantWords!.Count,
                "argument" => 2 + (int)(rng.NextDouble() * 4),
                _ => 2 + (int)(rng.NextDouble() * 5),
            };
            var start = plan.Time;
            var question = says == "question" || (says == "chatter" && rng.NextDouble() < 0.25) || (f.Shift > 1.5 && says == "greeting" && rng.NextDouble() < 0.3);
            var exclaim = says is "celebration" or "warning" or "command" || (says == "argument" && rng.NextDouble() < 0.5);
            // Each phrase starts a little higher and drifts down (declination); the stressed syllables stand out.
            var top = (says == "warning" ? 3 : 1) + range * 0.25;
            var sylIndex = 0;
            var phraseSyl = 0;
            var wordsInPhrase = new List<List<Syl>>();
            for (var w = 0; w < words; w++) wordsInPhrase.Add(says == "chant" ? chantWords![w % chantWords.Count] : Word());
            plan.Words.AddRange(wordsInPhrase.Select(x => string.Concat(x.Select(y => string.Concat(y.Onset) + y.Vowel + (y.Long ? ":" : "") + string.Concat(y.Coda)))));
            phraseSyl = wordsInPhrase.Sum(x => x.Count);
            for (var w = 0; w < wordsInPhrase.Count; w++)
            {
                var word = wordsInPhrase[w];
                // Hesitation: an "uh", or the start of the word said twice.
                var hes = Math.Max(l.Hesitation, l.Delivery == "stutter" ? 0.7 : 0);
                if (hes > 0 && rng.NextDouble() < hes * 0.35)
                {
                    if (rng.NextDouble() < 0.5) { var t0 = plan.Time; plan.Add(new Seg { Dur = syl * 1.6, Voice = 0.8, F1 = 520, F2 = 1450, F3 = 2500, Amp = 0.6 }); plan.Point(-1, t0); plan.Point(-1.5); AddPause(plan, syl * 0.5); }
                    else { foreach (var c in word[0].Onset) AddConsonant(plan, c, syl * 0.25, 0.8, VowelF(word[0].Vowel)); AddPause(plan, syl * 0.4); }
                }
                for (var k = 0; k < word.Count; k++)
                {
                    var stressed = style.StressLast ? k == word.Count - 1 : k == 0;
                    var last = w == wordsInPhrase.Count - 1 && k == word.Count - 1;
                    var x = phraseSyl <= 1 ? 0 : (double)sylIndex / (phraseSyl - 1);
                    var vowelDur = syl * 0.55 * (stressed ? 1.25 : 0.9) * (last ? 1.5 : 1) * f.Drawl * (l.Delivery == "singsong" ? 1.5 : 1) * (says == "chant" && stressed ? 1.3 : 1);
                    var amp = (stressed ? 1 : 0.78) * (last && !exclaim ? 0.85 : 1) * (exclaim && w == 0 ? 1.15 : 1);
                    var vStart = AddSyllable(plan, word[k], vowelDur, syl * 0.22 * Math.Sqrt(l.SyllableRate / 5), amp, last);
                    var vEnd = vStart + vowelDur;
                    // The pitch: declination, accents on stressed syllables, and the phrase's end (rise for a question).
                    double st = top - range * 0.5 * x + (stressed ? range * (0.35 + 0.35 * rng.NextDouble()) : 0) + (rng.NextDouble() - 0.5) * range * 0.15;
                    if (says == "chant") st = stressed ? range * 0.4 : 0;
                    double stEnd = st - (stressed ? range * 0.15 : 0);
                    if (last)
                    {
                        if (question) stEnd = st + range * 0.8;
                        else if (exclaim) { st += range * 0.5; stEnd = st - range * 0.9; }
                        else stEnd = st - range * 0.45;
                    }
                    if (l.Delivery == "singsong") { st = Quantize(st, scale); stEnd = last ? Quantize(stEnd, scale) : st; }
                    if (robotic) { st = Math.Round(st / 2) * 2; stEnd = st; }
                    plan.Point(st, vStart);
                    plan.Point(stEnd, vEnd);
                    sylIndex++;
                }
                // A tiny gap between some words.
                if (w < wordsInPhrase.Count - 1 && rng.NextDouble() < 0.3) AddPause(plan, syl * 0.15);
                if (plan.Time > total * 1.05) break;
            }
            phraseIndex++;
            // A pause between phrases (with a breath when it is long enough).
            if (plan.Time < total * 0.9)
            {
                var pause = syl * (1.5 + 3 * rng.NextDouble()) * (0.3 + 1.4 * l.Pauses) * f.Pause * (says is "argument" ? 0.6 : says is "greeting" or "warning" ? 1.4 : 1);
                AddPause(plan, Math.Min(pause, Math.Max(0.12, total * 0.25)), !robotic && (l.Delivery == "breathless" || pause > 0.45)); // robots don't breathe
            }
            if (plan.Time - start < 0.01) break;
        }
    }

    private static double Quantize(double st, double[] scale)
    {
        var oct = Math.Floor(st / 12);
        var within = st - oct * 12;
        var best = scale.OrderBy(s => Math.Abs(s - within)).First();
        return oct * 12 + best;
    }

    // ---------------------------------------------------------------- planning sounds with no words

    private static void PlanSound(SoundLayer l, SoundRng rng, Plan plan)
    {
        var total = l.VoiceLength;
        double R(double a, double b) => a + (b - a) * rng.NextDouble();
        double[] A = VowelF("a"), E = VowelF("e"), I = VowelF("i"), O = VowelF("o"), U = VowelF("u"), Sch = VowelF("@");
        Seg V(double d, double[] f, double amp = 1, double voice = 1) => new() { Dur = d, Voice = voice, F1 = f[0], F2 = f[1], F3 = f[2], Amp = amp };
        Seg H(double d, double[] f, double amp = 0.7, double asp = 0.6) => new() { Dur = d, Asp = asp, F1 = f[0], F2 = f[1], F3 = f[2], Amp = amp };
        void Inhale(double d, double[] f, double amp = 0.5) => plan.Add(new Seg { Dur = d, Asp = 0.5, Inhale = 1, F1 = f[0], F2 = f[1], F3 = f[2], Amp = amp });
        void Gap(double d) => plan.Add(new Seg { Dur = d });
        switch (l.VoiceSays)
        {
            case "laugh":
            case "giggle":
            case "chuckle":
            {
                var giggle = l.VoiceSays == "giggle"; var chuckle = l.VoiceSays == "chuckle";
                var vowel = giggle ? I : chuckle ? Sch : rng.NextDouble() < 0.7 ? A : ae();
                double[] ae() => VowelF("ae");
                var unit = giggle ? R(0.11, 0.14) : chuckle ? R(0.15, 0.2) : R(0.16, 0.21);
                var top = giggle ? 9 : chuckle ? -1 : R(4, 7);
                while (plan.Time < total * 0.95)
                {
                    var n = 3 + (int)(rng.NextDouble() * (giggle ? 4 : 6));
                    for (var k = 0; k < n && plan.Time < total; k++)
                    {
                        var amp = 1 - k * 0.07;
                        plan.Add(H(unit * 0.3, vowel, amp));
                        var t0 = plan.Time;
                        plan.Add(V(unit * 0.45, vowel, amp, chuckle ? 0.7 : 1));
                        if (chuckle) plan.Add(new Seg { Dur = unit * 0.15, Voice = 0.5, Nas = 1, F1 = 250, F2 = 1000, F3 = 2200, Amp = amp * 0.8 });
                        plan.Point(top - k * 0.6, t0); plan.Point(top - k * 0.6 - 1.5, plan.Time);
                        Gap(unit * 0.2);
                    }
                    if (plan.Time < total * 0.8) { Inhale(R(0.2, 0.32), I, 0.45); Gap(0.05); }
                    else break;
                }
                break;
            }
            case "cry":
            {
                while (plan.Time < total * 0.95)
                {
                    if (rng.NextDouble() < 0.45)
                    {
                        // Sobs: short broken "uh" with gasps.
                        for (var k = 0; k < 3 && plan.Time < total; k++)
                        {
                            var t0 = plan.Time;
                            plan.Add(V(R(0.12, 0.2), U, 0.8)); plan.Point(4, t0); plan.Point(1, plan.Time);
                            Inhale(R(0.08, 0.14), I, 0.5);
                        }
                    }
                    else
                    {
                        // A wail: a long vowel falling in pitch.
                        var d = Math.Min(R(0.5, 1.0), Math.Max(0.2, total - plan.Time));
                        var t0 = plan.Time;
                        plan.Add(H(0.06, A, 0.6)); plan.Add(V(d, rng.NextDouble() < 0.5 ? A : Sch, 1));
                        plan.Point(7, t0); plan.Point(8, t0 + d * 0.2); plan.Point(1, plan.Time);
                    }
                    if (plan.Time < total * 0.85) { Inhale(R(0.18, 0.3), I, 0.55); Gap(0.06); }
                }
                break;
            }
            case "scream":
            case "yelp":
            {
                var yelp = l.VoiceSays == "yelp";
                while (plan.Time < total * 0.95)
                {
                    var d = yelp ? Math.Min(R(0.15, 0.3), total) : Math.Min(R(0.7, 1.5), Math.Max(0.2, total - plan.Time));
                    var t0 = plan.Time;
                    if (yelp) { plan.Add(V(d * 0.6, A, 1.2)); plan.Add(V(d * 0.4, I, 0.9)); plan.Point(10, t0); plan.Point(14, t0 + d * 0.25); plan.Point(7, plan.Time); }
                    else { plan.Add(H(0.03, A, 0.8)); plan.Add(V(d, rng.NextDouble() < 0.6 ? A : VowelF("ae"), 1.3)); plan.Point(12, t0); plan.Point(17, t0 + d * 0.15); plan.Point(16, t0 + d * 0.7); plan.Point(9, plan.Time); }
                    if (plan.Time < total * 0.8) { Inhale(R(0.15, 0.3), A, 0.6); Gap(R(0.05, 0.2)); }
                    else break;
                }
                break;
            }
            case "grunt":
            {
                var d = Math.Clamp(total, 0.08, 0.8);
                var t0 = plan.Time;
                plan.Add(new Seg { Dur = 0.02 }); // a closed throat first
                plan.Add(V(d * 0.75, rng.NextDouble() < 0.5 ? Sch : U, 1.2));
                if (rng.NextDouble() < 0.5) plan.Add(new Seg { Dur = d * 0.25, Voice = 0.5, Nas = 1, F1 = 250, F2 = 1500, F3 = 2600, Amp = 0.8 }); else plan.Add(H(d * 0.25, Sch, 0.5));
                plan.Point(-2, t0); plan.Point(-1, t0 + d * 0.2); plan.Point(-6, plan.Time);
                break;
            }
            case "groan":
            {
                while (plan.Time < total * 0.95)
                {
                    var d = Math.Min(R(0.8, 1.6), Math.Max(0.3, total - plan.Time));
                    var t0 = plan.Time;
                    plan.Add(V(d * 0.5, U, 1)); plan.Add(V(d * 0.5, O, 0.9));
                    plan.Point(-1, t0); plan.Point(0, t0 + d * 0.3); plan.Point(-6, plan.Time);
                    if (plan.Time < total * 0.75) Inhale(R(0.3, 0.45), O, 0.4); else break;
                }
                break;
            }
            case "sigh":
            {
                Inhale(Math.Min(0.4, total * 0.3), I, 0.5);
                var d = Math.Max(0.3, total - plan.Time);
                var t0 = plan.Time;
                plan.Add(new Seg { Dur = d, Voice = 0.35, Asp = 0.7, F1 = A[0], F2 = A[1], F3 = A[2], Amp = 0.9 });
                plan.Point(1, t0); plan.Point(-5, plan.Time);
                break;
            }
            case "gasp":
            {
                var d = Math.Clamp(total, 0.12, 1);
                plan.Add(new Seg { Dur = d * 0.7, Asp = 0.8, Inhale = 1, Voice = 0.12, F1 = A[0], F2 = A[1], F3 = A[2], Amp = 1 });
                plan.Point(8, 0); plan.Point(12, plan.Time);
                Gap(d * 0.3);
                break;
            }
            case "growl":
            {
                while (plan.Time < total * 0.95)
                {
                    var d = Math.Min(R(0.6, 1.4), Math.Max(0.2, total - plan.Time));
                    var t0 = plan.Time;
                    plan.Add(new Seg { Dur = d, Voice = 0.9, Asp = 0.2, Trill = 0.45, F1 = O[0], F2 = O[1], F3 = O[2], Amp = 1 });
                    plan.Point(-1, t0); plan.Point(1, t0 + d * 0.5); plan.Point(-3, plan.Time);
                    if (plan.Time < total * 0.8) Inhale(R(0.2, 0.35), O, 0.35); else break;
                }
                break;
            }
            case "pant":
            {
                while (plan.Time < total * 0.97)
                {
                    Inhale(R(0.14, 0.2), A, 0.55);
                    plan.Add(new Seg { Dur = R(0.16, 0.24), Asp = 0.75, Voice = 0.08, F1 = A[0], F2 = A[1], F3 = A[2], Amp = 0.8 });
                    Gap(R(0.02, 0.06));
                }
                plan.Point(3, 0);
                break;
            }
            case "cheer":
            {
                while (plan.Time < total * 0.95)
                {
                    var kind = (int)(rng.NextDouble() * 3);
                    var t0 = plan.Time;
                    if (kind == 0) { AddConsonant(plan, "y", 0.07, 1.1, E); plan.Add(V(0.12, E, 1.2)); plan.Add(V(0.3, A, 1.2)); } // yeah
                    else if (kind == 1) { AddConsonant(plan, "w", 0.07, 1.1, U); plan.Add(V(0.45, U, 1.2)); } // woo
                    else { plan.Add(H(0.06, E, 0.8)); plan.Add(V(0.3, E, 1.2)); plan.Add(V(0.1, I, 1)); } // hey
                    plan.Point(5, t0); plan.Point(11, t0 + (plan.Time - t0) * 0.4); plan.Point(4, plan.Time);
                    if (plan.Time < total * 0.8) Gap(R(0.2, 0.45)); else break;
                }
                break;
            }
            case "hmm":
            {
                var d = Math.Max(0.25, total);
                var t0 = plan.Time;
                plan.Add(H(0.05, Sch, 0.4));
                plan.Add(new Seg { Dur = d * 0.15, Voice = 0.8, F1 = Sch[0], F2 = Sch[1], F3 = Sch[2], Amp = 0.8 });
                plan.Add(new Seg { Dur = d * 0.85, Voice = 0.7, Nas = 1, F1 = 250, F2 = 1000, F3 = 2200, Amp = 0.85 });
                if (rng.NextDouble() < 0.5) { plan.Point(0, t0); plan.Point(-3, plan.Time); } // thinking
                else { plan.Point(-1, t0); plan.Point(-2, t0 + d * 0.4); plan.Point(4, plan.Time); } // "hm?"
                break;
            }
        }
    }

    // ---------------------------------------------------------------- rendering

    /// <summary>The voice of a layer, mono, from its start (silence after the voice is not included).</summary>
    public static float[] Render(SoundLayer l, SoundRng rng, int sr)
    {
        var plan = new Plan();
        var FeelAt = Feeling(l);
        var speech = Says.FirstOrDefault(s => s.Id == l.VoiceSays)?.Group != "Sounds";
        if (speech) PlanSpeech(l, rng, plan, FeelAt); else PlanSound(l, rng, plan);
        if (plan.Segs.Count == 0 || plan.Time <= 0) return [];
        // Fit the asked length (speech is planned near it; this evens out the rest without changing its character much).
        if (speech)
        {
            // A trailing pause isn't part of it.
            while (plan.Segs.Count > 1 && plan.Segs[^1].Voice == 0 && plan.Segs[^1].Asp == 0 && plan.Segs[^1].Fric == 0) { plan.Time -= plan.Segs[^1].Dur; plan.Segs.RemoveAt(plan.Segs.Count - 1); }
            var k = Math.Clamp(l.VoiceLength / plan.Time, 0.75, 1.3);
            foreach (var s in plan.Segs) { s.T0 *= k; s.Dur *= k; }
            for (var i = 0; i < plan.Pitch.Count; i++) plan.Pitch[i] = (plan.Pitch[i].T * k, plan.Pitch[i].St);
            plan.Time *= k;
        }
        return Synthesize(l, plan, FeelAt, rng, sr);
    }

    private static Feel Lerp(Feel a, Feel b, double t) => Feel.Lerp(a, b, t);

    /// <summary>The feeling along the utterance (0 = its start, 1 = its end): the emotion, or an arc to another.</summary>
    private static Func<double, Feel> Feeling(SoundLayer l)
    {
        // Strength: half of it is most of the way there (a little emotion is already clearly heard).
        var amount = Math.Pow(l.EmotionAmount, 0.7);
        var startFeel = Lerp(Neutral, EmotionFeel(l.Emotion), amount);
        var endFeel = string.IsNullOrEmpty(l.EmotionEnd) ? startFeel : Lerp(Neutral, EmotionFeel(l.EmotionEnd), amount);
        return x => Feel.Lerp(startFeel, endFeel, Math.Clamp(x, 0, 1));
    }

    /// <summary>The words a speech layer says with this seed (for tests: one language keeps its words across takes).</summary>
    internal static IReadOnlyList<string> Words(SoundLayer l, int seed)
    {
        var plan = new Plan();
        var feel = Lerp(Neutral, EmotionFeel(l.Emotion), l.EmotionAmount);
        PlanSpeech(l, new SoundRng((ulong)(uint)seed * 0x100000001B3UL + 17), plan, _ => feel);
        return plan.Words;
    }

    /// <summary>A two-pole resonator (a formant), with its coefficients updated as the formant moves.</summary>
    private struct Reso
    {
        private double a, b, c, y1, y2;
        public void Set(double f, double bw, int sr)
        {
            f = Math.Min(f, sr * 0.45);
            var r = Math.Exp(-Math.PI * bw / sr);
            c = -r * r; b = 2 * r * Math.Cos(2 * Math.PI * f / sr); a = 1 - b - c;
        }
        public double Run(double x) { var y = a * x + b * y1 + c * y2; y2 = y1; y1 = y; return y; }
    }

    private struct Band
    {
        private double b0, b2, a1, a2, x1, x2, y1, y2;
        public void Set(double f, double bw, int sr)
        {
            f = Math.Clamp(f, 50, sr * 0.45);
            var q = Math.Max(0.3, f / Math.Max(50, bw));
            var w = 2 * Math.PI * f / sr; var alpha = Math.Sin(w) / (2 * q); var a0 = 1 + alpha;
            b0 = alpha / a0; b2 = -alpha / a0; a1 = -2 * Math.Cos(w) / a0; a2 = (1 - alpha) / a0;
        }
        public double Run(double x) { var y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; }
    }

    private static float[] Synthesize(SoundLayer l, Plan plan, Func<double, Feel> feelAt, SoundRng rng, int sr)
    {
        var total = (int)((plan.Time + 0.12) * sr);
        var outp = new float[total];
        var fs = 1 / Math.Clamp(l.VoiceSize, 0.4, 2.5); // a smaller body: higher formants
        var robotic = l.Delivery == "robotic";
        var whisper = l.Delivery == "whisper";
        var shout = l.Delivery == "shout";
        var mumble = l.Delivery == "mumble";
        var clarity = Math.Clamp(l.Clarity * (mumble ? 0.35 : 1), 0, 1);
        // The pitch contour, in semitones, sampled at each point and glided between.
        var pts = plan.Pitch.OrderBy(p => p.T).ToList();
        if (pts.Count == 0) pts.Add((0, 0));
        var pi = 0;
        double StAt(double t)
        {
            while (pi + 1 < pts.Count && pts[pi + 1].T <= t) pi++;
            if (t <= pts[0].T) return pts[0].St;
            if (pi + 1 >= pts.Count) return pts[^1].St;
            var (t0, s0) = pts[pi]; var (t1, s1) = pts[pi + 1];
            var u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
            u = u * u * (3 - 2 * u);
            return s0 + (s1 - s0) * u;
        }
        Span<Reso> f = stackalloc Reso[5];
        var nasal = new Reso(); var nasalZero = new Reso();
        var fric = new Band(); var burstBand = new Band(); var tremorPhase = 0.0;
        double sF1 = 500, sF2 = 1500, sF3 = 2500, sVoice = 0, sAsp = 0, sFric = 0, sNas = 0, sTrill = 0, sAmp = 0, sFricF = 4000, sFricBw = 2000, sPitch = 0;
        double phase = 0, prevFlow = 0, tilt = 0, hp = 0, hpPrev = 0, burstEnv = 0, clickEnv = 0;
        double periodJitter = 1, periodAmp = 1, sub = 1;
        var periodCount = 0;
        var seg = 0;
        var segs = plan.Segs;
        var kF = 1 - Math.Exp(-1 / (0.016 * sr)); // formants glide over ~16 ms
        var kA = 1 - Math.Exp(-1 / (0.006 * sr)); // loudness over ~6 ms
        var kP = 1 - Math.Exp(-1 / ((robotic ? 0.004 : 0.03) * sr));
        var creature = l.Creature;
        var lastSeg = -1;
        Feel fe = feelAt(0);
        for (var i = 0; i < total; i++)
        {
            var t = (double)i / sr;
            while (seg + 1 < segs.Count && segs[seg + 1].T0 <= t) seg++;
            var s = segs[seg];
            var inside = t < s.T0 + s.Dur;
            if (seg != lastSeg)
            {
                lastSeg = seg;
                fe = feelAt(t / Math.Max(0.01, plan.Time));
                if (s.Burst > 0) { burstEnv = s.Burst; burstBand.Set(s.BurstF * Math.Sqrt(fs), s.BurstF * 0.8, sr); }
                if (s.Click > 0) { clickEnv = 1; burstBand.Set(s.BurstF * fs, 600, sr); }
                if (s.Fric > 0) { sFricF = s.FricF * Math.Sqrt(fs); sFricBw = s.FricBw; }
            }
            // Targets (silence after the plan's end).
            double tv = inside ? s.Voice : 0, ta = inside ? s.Asp : 0, tf = inside ? s.Fric : 0, tn = inside ? s.Nas : 0, tt = inside ? s.Trill : 0, tamp = inside ? s.Amp : 0;
            if (s.F1 > 0) { sF1 += (s.F1 - sF1) * kF; sF2 += (s.F2 - sF2) * kF; sF3 += (s.F3 - sF3) * kF; }
            sVoice += (tv - sVoice) * kA; sAsp += (ta - sAsp) * kA; sFric += (tf - sFric) * kA; sNas += (tn - sNas) * kF; sTrill += (tt - sTrill) * kA; sAmp += (tamp - sAmp) * kA;
            if ((i & 31) == 0)
            {
                // Formants: a smaller body is higher; mumbling pulls them toward the middle; low clarity widens them.
                var pull = 1 - clarity;
                double F(double v, double mid) => (v + (mid - v) * pull * 0.5) * fs;
                var bwk = 1 + pull * 1.5 + (whisper ? 0.6 : 0);
                f[0].Set(F(sF1, 500), 70 * bwk + 40 * sNas, sr);
                f[1].Set(F(sF2, 1500), 95 * bwk, sr);
                f[2].Set(F(sF3, 2500), 150 * bwk, sr);
                f[3].Set(3500 * fs, 250 * bwk, sr);
                f[4].Set(4500 * fs, 320 * bwk, sr);
                nasal.Set(270 * Math.Sqrt(fs), 110, sr);
                nasalZero.Set(1100 * fs, 300, sr);
                fric.Set(sFricF, sFricBw, sr);
            }
            // Pitch.
            var st = StAt(t) + fe.Shift + (shout ? 4 : 0);
            sPitch += (st - sPitch) * kP;
            tremorPhase += (5.5 + 2 * rng.NextDouble()) / sr;
            var tremor = fe.Tremor * 0.6 * Math.Sin(2 * Math.PI * tremorPhase);
            var f0 = l.Pitch * Math.Pow(2, (sPitch + tremor) / 12) * periodJitter / sub;
            f0 = Math.Clamp(f0, 25, 2000);
            phase += f0 / sr;
            if (phase >= 1)
            {
                phase -= 1; periodCount++;
                // Each period: rasp (jitter, shimmer), creak (long uneven periods) and growl (every other period weaker, longer).
                var rasp = Math.Clamp(l.Rasp + fe.Rasp, 0, 1);
                periodJitter = robotic ? 1 : 1 + (rng.NextDouble() - 0.5) * (0.01 + rasp * 0.12);
                periodAmp = robotic ? 1 : 1 - rng.NextDouble() * rasp * 0.5;
                sub = 1;
                if (creature > 0 && (periodCount & 1) == 1) { periodAmp *= 1 - 0.7 * creature; sub = 1 + 0.25 * creature; }
                if (fe.Creak > 0 && rng.NextDouble() < fe.Creak * 0.35 * (sAmp < 0.9 ? 1.3 : 1)) { sub = 1.6 + rng.NextDouble() * 0.8; periodAmp *= 0.7; }
            }
            // The glottal pulse (Rosenberg) and its change (what the air does): brighter with more effort.
            var effort = Math.Clamp(fe.Effort + (shout ? 0.35 : 0) - (mumble ? 0.2 : 0), 0, 1);
            var oq = 0.75 - 0.3 * effort + 0.15 * l.Breath;
            var tp = oq * 0.62;
            var flow = phase < tp ? 0.5 * (1 - Math.Cos(Math.PI * phase / tp)) : phase < oq ? Math.Cos(Math.PI / 2 * (phase - tp) / (oq - tp)) : 0;
            var dflow = (flow - prevFlow) * sr / Math.Max(60, f0) * 0.08; prevFlow = flow;
            var tiltK = 1 - Math.Exp(-2 * Math.PI * (900 + 7000 * effort) / sr);
            tilt += (dflow - tilt) * tiltK;
            var trill = sTrill > 0.01 ? 1 - sTrill * (0.5 + 0.5 * Math.Sin(2 * Math.PI * 27 * t)) : 1;
            var voiceAmt = whisper ? 0 : sVoice;
            var breath = Math.Clamp(l.Breath + fe.Breath + (whisper ? 0.8 : 0), 0, 1);
            var noise = rng.Bipolar();
            var src = tilt * periodAmp * voiceAmt * trill * (1 - breath * 0.4);
            // Breath rides on the glottal flow; aspiration (h) and whispering are noise through the same mouth.
            src += noise * 0.35 * (breath * voiceAmt * (0.3 + flow) + sAsp + (whisper ? sVoice * 0.9 : 0));
            if (l.Rasp + fe.Rasp > 0) src += noise * 0.2 * Math.Clamp(l.Rasp + fe.Rasp, 0, 1) * voiceAmt * flow;
            var y = src;
            for (var k = 0; k < 5; k++) y = f[k].Run(y) * (k == 0 ? 1 : 1);
            // Nasality: a low resonance and a dip in the middle; nasal consonants are mostly that.
            var nas = Math.Clamp(sNas + (l.Nasal + fe.Nasal) * 0.6, 0, 1);
            if (nas > 0.01)
            {
                var nr = nasal.Run(src);
                var dip = nasalZero.Run(y);
                y = y * (1 - nas * 0.7) - dip * nas * 0.4 + nr * nas * 2.5;
            }
            // Frication (s, sh, f…), bursts (p, t, k) and clicks, after the mouth.
            if (sFric > 0.001) y += fric.Run(noise) * sFric * 0.8 * (0.5 + clarity);
            if (burstEnv > 0.001 || clickEnv > 0.001)
            {
                y += burstBand.Run(noise * burstEnv + (clickEnv > 0.99 ? 3 : 0)) * 0.7;
                burstEnv *= Math.Exp(-1 / (0.008 * sr)); clickEnv *= Math.Exp(-1 / (0.002 * sr));
            }
            var loud = fe.Loud * (shout ? 1.25 : 1) * (mumble ? 0.6 : 1) * (whisper ? 0.8 : 1);
            var v = y * sAmp * loud;
            if (robotic) v = Math.Tanh(v * 2.5) * 0.5;
            // A gentle low cut (no rumble, no offset).
            hp = 0.995 * (hp + v - hpPrev); hpPrev = v;
            outp[i] = (float)hp;
        }
        // Even level: the loudest part at -3 dB (the layer's own level then sets it).
        var peak = 0f;
        foreach (var x in outp) peak = Math.Max(peak, Math.Abs(x));
        if (peak > 1e-6) { var g = 0.7f / peak; for (var i = 0; i < outp.Length; i++) outp[i] *= g; }
        // No click at the very end.
        var fade = Math.Min(outp.Length, sr / 100);
        for (var i = 0; i < fade; i++) outp[outp.Length - 1 - i] *= (float)i / fade;
        return outp;
    }

    private static ulong Hash(string s) { ulong h = 1469598103934665603UL; foreach (var c in s) { h ^= c; h *= 1099511628211UL; } return h; }
}
