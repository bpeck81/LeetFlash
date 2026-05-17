import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { fetchProblemPage } from "./lib/problemFeed";
import type { LeetProblem } from "./data/problems";
import {
  readQuestionNumberFromUrl,
  readStoredValue,
  writeQuestionUrl,
  writeStoredValue
} from "./lib/persistence";
import { getAnonymousSession, hasSupabaseConfig, supabase } from "./lib/supabase";

const queryKey = ["leet-problems"];
const leetcodeUrl = (slug: string) => `https://leetcode.com/problems/${slug}/`;
const pythonKeywordPattern =
  /\b(class|def|return|for|in|if|elif|else|while|not|or|and|True|False|None|from|import|as|with|pass|break|continue|range|len|enumerate|set|float|int|str|bool|List|Optional)\b/g;
const webScrollStyle =
  Platform.OS === "web"
    ? ({ overflowY: "auto", overflowX: "hidden" } as object)
    : null;
const lastQuestionKey = "leetflash:lastQuestionId";
const randomModeKey = "leetflash:randomMode";
const foldStateKey = "leetflash:foldState";

type FoldState = {
  examples: boolean;
  constraints: boolean;
  approach: boolean;
  solution: boolean;
};

const defaultFoldState: FoldState = {
  examples: false,
  constraints: false,
  approach: false,
  solution: true
};
const missingExamplesText =
  "Examples are not loaded for this card yet. Open the LeetCode link to view the original examples.";
const missingConstraintsText =
  "Constraints are not loaded for this card yet. Open the LeetCode link to view the original constraints.";

type QuestionSolution = {
  question_id: number;
  prompt: string;
  examples: string;
  constraints_text: string;
  approach: string[];
  solution: string;
  starter_code: string;
};

export function LeetFlash() {
  const queryClient = useQueryClient();
  const listRef = useRef<ScrollView>(null);
  const initialQuestionId =
    readQuestionNumberFromUrl() ?? (Number(readStoredValue(lastQuestionKey)) || 1);
  const initialCursor = Math.max(initialQuestionId - 1, 0);
  const [width, setWidth] = useState(Dimensions.get("window").width);
  const [listHeight, setListHeight] = useState(
    Math.max(Dimensions.get("window").height - 56, 320)
  );
  const [index, setIndex] = useState(0);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  const [randomMode, setRandomMode] = useState(
    readStoredValue(randomModeKey) === "true"
  );
  const [jumpInput, setJumpInput] = useState(String(initialQuestionId));
  const [solutionMap, setSolutionMap] = useState<Record<number, QuestionSolution>>({});
  const [generatingIds, setGeneratingIds] = useState<Record<number, boolean>>({});
  const [foldState, setFoldState] = useState<FoldState>(() => readFoldState());
  const [pageStartedAt, setPageStartedAt] = useState(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchProblemPage(pageParam),
    initialPageParam: initialCursor,
    getNextPageParam: (lastPage: Awaited<ReturnType<typeof fetchProblemPage>>) =>
      lastPage.nextCursor ?? undefined
  });

  const problems = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data]
  );

  const activeProblem = problems[index];
  const activeSolution = activeProblem ? solutionMap[activeProblem.id] : undefined;
  const renderedProblem =
    activeProblem && activeSolution
      ? {
          ...activeProblem,
          prompt: activeSolution.prompt || activeProblem.prompt,
          examples: activeSolution.examples,
          constraints: activeSolution.constraints_text,
          bullets: activeSolution.approach,
          solution: activeSolution.solution,
          starterCode: activeSolution.starter_code,
          hasSolution: true
        }
      : activeProblem;

  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", ({ window }) => {
      setWidth(window.width);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (problems.length > 0 && problems.length - index <= 4 && query.hasNextPage) {
      void query.fetchNextPage();
    }
  }, [index, problems.length, query]);

  useEffect(() => {
    void queryClient.prefetchInfiniteQuery({
      queryKey,
      queryFn: ({ pageParam }) => fetchProblemPage(pageParam),
      initialPageParam: 0,
      getNextPageParam: (lastPage: Awaited<ReturnType<typeof fetchProblemPage>>) =>
        lastPage.nextCursor ?? undefined
    });
  }, [queryClient]);

  useEffect(() => {
    let mounted = true;

    void getAnonymousSession().then(async (session) => {
      if (!mounted || !session?.user.id) return;

      setSessionUserId(session.user.id);
      const settings = await supabase
        .from("user_settings")
        .select("last_question_id, random_mode")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (settings.data?.random_mode !== undefined) {
        setRandomMode(settings.data.random_mode);
        writeStoredValue(randomModeKey, String(settings.data.random_mode));
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activeProblem) return;

    const now = Date.now();
    setPageStartedAt(now);
    setElapsedSeconds(0);
    writeStoredValue(lastQuestionKey, String(activeProblem.id));
    writeQuestionUrl(activeProblem.id);
    setJumpInput(String(activeProblem.id));

    if (sessionUserId) {
      void supabase.from("user_settings").upsert({
        user_id: sessionUserId,
        last_question_id: activeProblem.id,
        random_mode: randomMode
      });

      void supabase
        .from("user_question_progress")
        .select("seen")
        .eq("user_id", sessionUserId)
        .eq("question_id", activeProblem.id)
        .maybeSingle()
        .then((result) => setSeen(Boolean(result.data?.seen)));
    } else {
      setSeen(readStoredValue(`leetflash:seen:${activeProblem.id}`) === "true");
    }

    void loadOrGenerateSolution(activeProblem);
  }, [activeProblem?.id, randomMode, sessionUserId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - pageStartedAt) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [pageStartedAt]);

  const goTo = (nextIndex: number) => {
    if (problems.length === 0) return;

    const clamped = Math.max(0, Math.min(nextIndex, problems.length - 1));
    setIndex(clamped);
    listRef.current?.scrollTo({ x: clamped * width, animated: true });
  };

  const goNext = () => {
    if (randomMode) {
      void goToQuestionNumber(randomQuestionId(activeProblem?.id));
      return;
    }

    goTo(index + 1);
  };

  const goToQuestionNumber = async (questionId: number) => {
    const normalized = Math.max(1, Math.floor(questionId));
    const existingIndex = problems.findIndex((problem) => problem.id === normalized);

    if (existingIndex >= 0) {
      goTo(existingIndex);
      return;
    }

    const page = await fetchProblemPage(normalized - 1);
    queryClient.setQueryData(queryKey, (current: typeof query.data) => {
      if (!current) {
        return { pageParams: [normalized - 1], pages: [page] };
      }

      return {
        ...current,
        pageParams: [...current.pageParams, normalized - 1],
        pages: [...current.pages, page]
      };
    });

    setTimeout(() => {
      const nextIndex = problems.length;
      setIndex(nextIndex);
      listRef.current?.scrollTo({ x: nextIndex * width, animated: true });
    }, 50);
  };

  const updateSeen = (nextSeen: boolean) => {
    if (!activeProblem) return;

    setSeen(nextSeen);
    writeStoredValue(`leetflash:seen:${activeProblem.id}`, String(nextSeen));

    if (sessionUserId) {
      void supabase.from("user_question_progress").upsert({
        user_id: sessionUserId,
        question_id: activeProblem.id,
        seen: nextSeen,
        last_seen_at: new Date().toISOString()
      });
    }
  };

  const updateFoldState = (key: keyof FoldState) => {
    setFoldState((current) => {
      const next = { ...current, [key]: !current[key] };
      writeStoredValue(foldStateKey, JSON.stringify(next));
      return next;
    });
  };

  const toggleRandomMode = () => {
    const nextRandomMode = !randomMode;
    setRandomMode(nextRandomMode);
    writeStoredValue(randomModeKey, String(nextRandomMode));

    if (sessionUserId) {
      void supabase.from("user_settings").upsert({
        user_id: sessionUserId,
        last_question_id: activeProblem?.id ?? null,
        random_mode: nextRandomMode
      });
    }
  };

  const loadOrGenerateSolution = async (problem: LeetProblem) => {
    if (solutionMap[problem.id] || generatingIds[problem.id] || !hasSupabaseConfig) {
      return;
    }

    const existing = await supabase
      .from("question_solutions")
      .select("question_id, prompt, examples, constraints_text, approach, solution, starter_code")
      .eq("question_id", problem.id)
      .maybeSingle();

    if (isCompleteCard(existing.data)) {
      setSolutionMap((current) => ({
        ...current,
        [problem.id]: existing.data as QuestionSolution
      }));
      return;
    }

    setGeneratingIds((current) => ({ ...current, [problem.id]: true }));
    const generated = await supabase.functions.invoke("generate-solution", {
      body: {
        question: {
          id: problem.id,
          slug: problem.slug,
          title: problem.title,
          difficulty: problem.difficulty,
          prompt: problem.prompt,
          examples: problem.examples,
          constraints: problem.constraints,
          starterCode: problem.starterCode
        }
      }
    });

    if (generated.data?.solution) {
      setSolutionMap((current) => ({
        ...current,
        [problem.id]: generated.data.solution as QuestionSolution
      }));
    }

    setGeneratingIds((current) => ({ ...current, [problem.id]: false }));
  };

  const openProblem = () => {
    if (!activeProblem) return;
    void Linking.openURL(leetcodeUrl(activeProblem.slug));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View
        style={styles.shell}
        onLayout={(event) => {
          setWidth(event.nativeEvent.layout.width);
        }}
      >
        <View style={styles.topBar}>
          <Pressable
            accessibilityLabel="Previous problem"
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            onPress={() => goTo(index - 1)}
          >
            <Text style={styles.chevron}>‹</Text>
          </Pressable>

          <Pressable
            accessibilityRole="link"
            style={({ pressed }) => [styles.problemLink, pressed && styles.pressed]}
            onPress={openProblem}
          >
            <View style={styles.problemLinkContent}>
              <Text style={styles.problemNumber}>
                {activeProblem ? `#${activeProblem.id}` : "LeetFlash"}
              </Text>
              {activeProblem ? <Text style={styles.externalIcon}>↗</Text> : null}
            </View>
          </Pressable>

          <View style={styles.timerPill}>
            <Text style={styles.timerText}>{formatElapsed(elapsedSeconds)}</Text>
          </View>

          <Pressable
            accessibilityLabel="Next problem"
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            onPress={goNext}
          >
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>

        <View style={styles.controlsBar}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: seen }}
            style={({ pressed }) => [
              styles.seenControl,
              seen && styles.seenControlChecked,
              pressed && styles.pressed
            ]}
            onPress={() => updateSeen(!seen)}
          >
            <Text style={[styles.checkbox, seen && styles.checkboxChecked]}>
              {seen ? "✓" : ""}
            </Text>
            <Text style={styles.controlText}>Seen</Text>
          </Pressable>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: randomMode }}
            style={({ pressed }) => [
              styles.modeControl,
              randomMode && styles.modeControlActive,
              pressed && styles.pressed
            ]}
            onPress={toggleRandomMode}
          >
            <Text
              style={[styles.controlText, randomMode && styles.modeControlTextActive]}
            >
              Random
            </Text>
          </Pressable>

          <View style={styles.jumpControl}>
            <TextInput
              value={jumpInput}
              onChangeText={setJumpInput}
              keyboardType="number-pad"
              placeholder="#"
              placeholderTextColor="#94a3b8"
              style={styles.jumpInput}
              onSubmitEditing={() => {
                void goToQuestionNumber(Number(jumpInput));
              }}
            />
            <Pressable
              style={({ pressed }) => [styles.jumpButton, pressed && styles.pressed]}
              onPress={() => {
                void goToQuestionNumber(Number(jumpInput));
              }}
            >
              <Text style={styles.jumpButtonText}>Go</Text>
            </Pressable>
          </View>
        </View>

        <View
          style={styles.listContainer}
          onLayout={(event) => {
            setListHeight(Math.max(event.nativeEvent.layout.height, 320));
          }}
        >
          {query.isLoading ? (
            <View style={styles.loader}>
              <ActivityIndicator color="#111827" />
            </View>
          ) : (
            <ScrollView
              ref={listRef}
              horizontal
              pagingEnabled
              snapToInterval={width}
              snapToAlignment="start"
              decelerationRate="fast"
              disableIntervalMomentum
              bounces={false}
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onMomentumScrollEnd={(event) => {
                const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
                setIndex(nextIndex);
                if (problems.length - nextIndex <= 4 && query.hasNextPage) {
                  void query.fetchNextPage();
                }
              }}
              onScrollEndDrag={(event) => {
                const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
                listRef.current?.scrollTo({ x: nextIndex * width, animated: true });
              }}
            >
              {problems.map((item, itemIndex) => (
                  <View
                    key={`${item.id}-${itemIndex}`}
                    style={[styles.itemFrame, { width, height: listHeight }]}
                  >
                    <ProblemCard
                      problem={item.id === renderedProblem?.id ? renderedProblem : item}
                      height={listHeight}
                    isGeneratingSolution={Boolean(generatingIds[item.id])}
                    foldState={foldState}
                    onToggleFold={updateFoldState}
                  />
                  </View>
                ))}
            </ScrollView>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

type ProblemCardProps = {
  problem: LeetProblem;
  height: number;
  isGeneratingSolution: boolean;
  foldState: FoldState;
  onToggleFold: (key: keyof FoldState) => void;
};

function ProblemCard({
  problem,
  height,
  isGeneratingSolution,
  foldState,
  onToggleFold
}: ProblemCardProps) {
  const promptParts = useMemo(() => splitProblemPrompt(problem.prompt), [problem.prompt]);
  const examples = problem.examples ?? promptParts.examples;
  const constraints = problem.constraints ?? promptParts.constraints;

  return (
    <ScrollView
      style={[styles.card, { height, maxHeight: height }, webScrollStyle]}
      contentContainerStyle={styles.cardContent}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      showsVerticalScrollIndicator
    >
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Problem</Text>
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text style={styles.title}>{problem.title}</Text>
            <Text style={[styles.meta, difficultyStyle(problem.difficulty)]}>
              {problem.difficulty}
            </Text>
          </View>
        </View>

        <View style={styles.statementBox}>
          <Text style={styles.prompt}>{promptParts.statement}</Text>
        </View>

        <FoldableSection
          title="Examples"
          open={foldState.examples}
          onToggle={() => onToggleFold("examples")}
        >
          <Text style={styles.promptDetail}>
            {examples || missingExamplesText}
          </Text>
        </FoldableSection>

        <FoldableSection
          title="Constraints"
          open={foldState.constraints}
          onToggle={() => onToggleFold("constraints")}
        >
          <Text style={styles.promptDetail}>
            {constraints || missingConstraintsText}
          </Text>
        </FoldableSection>

        {promptParts.followUp ? (
          <Text style={styles.followUp}>{promptParts.followUp}</Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <FoldableSection
          title="Approach"
          open={foldState.approach}
          onToggle={() => onToggleFold("approach")}
        >
          <View style={styles.bullets}>
            {problem.bullets.map((bullet) => (
              <Text key={bullet} style={styles.bullet}>
                • {bullet}
              </Text>
            ))}
          </View>
        </FoldableSection>
      </View>

      <View style={styles.section}>
        <FoldableSection
          title="Solution"
          open={foldState.solution}
          onToggle={() => onToggleFold("solution")}
        >
          <View style={styles.solution}>
            {isGeneratingSolution ? (
              <SolutionSkeleton />
            ) : (
              <SyntaxHighlightedCode code={problem.solution} />
            )}
          </View>
        </FoldableSection>
      </View>

      <View style={styles.section}>
        <Text style={styles.practiceLabel}>Practice typing</Text>
        <TextInput
          key={problem.slug}
          multiline
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={getPracticeStarter(problem)}
          placeholder="Practice typing here..."
          placeholderTextColor="#9ca3af"
          style={styles.practice}
          textAlignVertical="top"
        />
      </View>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

function SolutionSkeleton() {
  return (
    <View style={styles.skeletonBlock}>
      <Text style={styles.skeletonTitle}>Getting solution with AI</Text>
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonLineWide]} />
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
    </View>
  );
}

function randomQuestionId(currentId?: number): number {
  const next = Math.floor(Math.random() * 3934) + 1;
  return next === currentId ? randomQuestionId(currentId) : next;
}

function isCompleteCard(card: unknown): card is QuestionSolution {
  const candidate = card as Partial<QuestionSolution> | null;

  return Boolean(
    candidate?.prompt &&
      candidate?.examples &&
      candidate?.constraints_text &&
      candidate?.solution &&
      candidate?.approach?.length
  );
}

function difficultyStyle(difficulty: LeetProblem["difficulty"]) {
  switch (difficulty) {
    case "Easy":
      return styles.metaEasy;
    case "Medium":
      return styles.metaMedium;
    case "Hard":
      return styles.metaHard;
    default:
      return null;
  }
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function readFoldState(): FoldState {
  const raw = readStoredValue(foldStateKey);
  if (!raw) return defaultFoldState;

  try {
    return { ...defaultFoldState, ...(JSON.parse(raw) as Partial<FoldState>) };
  } catch {
    return defaultFoldState;
  }
}

type FoldableSectionProps = {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

function FoldableSection({ title, open, onToggle, children }: FoldableSectionProps) {
  return (
    <View style={styles.foldable}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.foldableHeader, pressed && styles.pressed]}
        hitSlop={8}
        onPressIn={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <Text style={styles.foldableTitle}>{title}</Text>
        <Text style={styles.foldableChevron}>{open ? "⌃" : "⌄"}</Text>
      </Pressable>
      {open ? <View style={styles.foldableBody}>{children}</View> : null}
    </View>
  );
}

function splitProblemPrompt(prompt: string) {
  const normalized = prompt.trim();
  const exampleIndex = normalized.search(/\bExample\s+\d+:/i);
  const constraintsIndex = normalized.search(/\bConstraints:/i);
  const followUpIndex = normalized.search(/\bFollow-up:/i);

  const firstFoldIndex = [exampleIndex, constraintsIndex, followUpIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  const statement =
    firstFoldIndex === undefined ? normalized : normalized.slice(0, firstFoldIndex).trim();

  const examples =
    exampleIndex >= 0
      ? normalized
          .slice(
            exampleIndex,
            nextPositiveIndex([constraintsIndex, followUpIndex], exampleIndex) ??
              normalized.length
          )
          .trim()
      : "";

  const constraints =
    constraintsIndex >= 0
      ? normalized
          .slice(
            constraintsIndex,
            nextPositiveIndex([followUpIndex], constraintsIndex) ?? normalized.length
          )
          .trim()
      : "";

  const followUp =
    followUpIndex >= 0 ? normalized.slice(followUpIndex).trim() : "";

  return { statement, examples, constraints, followUp };
}

function nextPositiveIndex(indexes: number[], after: number) {
  return indexes.filter((index) => index > after).sort((a, b) => a - b)[0];
}

function getPracticeStarter(problem: LeetProblem) {
  const starter = problem.starterCode ?? problem.solution;
  const [classLine, signatureLine] = starter.split("\n");
  return `${classLine}\n${signatureLine}\n        `;
}

function SyntaxHighlightedCode({ code }: { code: string }) {
  const spans = useMemo(() => highlightPython(code), [code]);

  return (
    <Text selectable style={styles.code}>
      {spans.map((span, index) => (
        <Text key={`${span.text}-${index}`} style={span.style}>
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

function highlightPython(code: string) {
  const spans: { text: string; style?: object }[] = [];

  for (const line of code.split(/(\n)/)) {
    if (line === "\n") {
      spans.push({ text: line });
      continue;
    }

    let cursor = 0;
    const commentIndex = line.indexOf("#");
    const codePart = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    const commentPart = commentIndex >= 0 ? line.slice(commentIndex) : "";

    for (const match of codePart.matchAll(
      /("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|\b\d+(?:\.\d+)?\b|\b(?:class|def|return|for|in|if|elif|else|while|not|or|and|True|False|None|from|import|as|with|pass|break|continue|range|len|enumerate|set|float|int|str|bool|List|Optional)\b)/g
    )) {
      const start = match.index ?? 0;
      const token = match[0];

      if (start > cursor) {
        spans.push({ text: codePart.slice(cursor, start) });
      }

      spans.push({ text: token, style: pythonStyleForToken(token) });
      cursor = start + token.length;
    }

    if (cursor < codePart.length) {
      spans.push({ text: codePart.slice(cursor) });
    }

    if (commentPart) {
      spans.push({ text: commentPart, style: styles.codeComment });
    }
  }

  return spans;
}

function pythonStyleForToken(token: string) {
  if (/^["']/.test(token)) return styles.codeString;
  if (/^\d/.test(token)) return styles.codeNumber;
  if (pythonKeywordPattern.test(token)) {
    pythonKeywordPattern.lastIndex = 0;
    return styles.codeKeyword;
  }
  pythonKeywordPattern.lastIndex = 0;
  return undefined;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f8fafc"
  },
  shell: {
    flex: 1,
    alignSelf: "center",
    width: "100%",
    maxWidth: 840,
    backgroundColor: "#f8fafc"
  },
  topBar: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d1d5db"
  },
  controlsBar: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d1d5db",
    backgroundColor: "#f8fafc"
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6
  },
  chevron: {
    color: "#111827",
    fontSize: 34,
    lineHeight: 36,
    fontWeight: "300"
  },
  problemLink: {
    minWidth: 112,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6
  },
  timerPill: {
    position: "absolute",
    right: 62,
    height: 30,
    minWidth: 52,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    backgroundColor: "#ffffff"
  },
  timerText: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "800"
  },
  problemNumber: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "700"
  },
  problemLinkContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6
  },
  externalIcon: {
    color: "#475569",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 18
  },
  pressed: {
    opacity: 0.64
  },
  seenControl: {
    height: 36,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    backgroundColor: "#ffffff"
  },
  seenControlChecked: {
    borderColor: "#0f766e",
    backgroundColor: "#ecfdf5"
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: "#94a3b8",
    borderRadius: 4,
    color: "#0f766e",
    textAlign: "center",
    lineHeight: 16,
    fontSize: 13,
    fontWeight: "900"
  },
  checkboxChecked: {
    borderColor: "#0f766e",
    backgroundColor: "#ccfbf1"
  },
  controlText: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "800"
  },
  modeControl: {
    height: 36,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    backgroundColor: "#ffffff"
  },
  modeControlActive: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff"
  },
  modeControlTextActive: {
    color: "#1d4ed8"
  },
  jumpControl: {
    marginLeft: "auto",
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    backgroundColor: "#ffffff",
    overflow: "hidden"
  },
  jumpInput: {
    width: 70,
    height: 36,
    paddingHorizontal: 10,
    color: "#111827",
    fontSize: 16,
    fontWeight: "700"
  },
  jumpButton: {
    height: 36,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
    borderLeftColor: "#cbd5e1",
    backgroundColor: "#f1f5f9"
  },
  jumpButtonText: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "900"
  },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  listContainer: {
    flex: 1,
    minHeight: 0
  },
  itemFrame: {
    flexShrink: 0
  },
  card: {
    flexGrow: 0
  },
  cardContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: Platform.select({ web: 160, default: 160 }),
    gap: 18
  },
  section: {
    paddingBottom: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#cbd5e1",
    gap: 12
  },
  sectionLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  titleText: {
    flex: 1,
    gap: 4
  },
  title: {
    color: "#0f172a",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800"
  },
  meta: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden"
  },
  metaEasy: {
    color: "#0f766e",
    backgroundColor: "#ccfbf1"
  },
  metaMedium: {
    color: "#a16207",
    backgroundColor: "#fef3c7"
  },
  metaHard: {
    color: "#b91c1c",
    backgroundColor: "#fee2e2"
  },
  prompt: {
    color: "#1f2937",
    fontSize: 16,
    lineHeight: 25
  },
  statementBox: {
    padding: 14,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    backgroundColor: "#ffffff"
  },
  promptDetail: {
    color: "#334155",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace"
    }),
    fontSize: 13,
    lineHeight: 20
  },
  followUp: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700"
  },
  foldable: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    overflow: "hidden"
  },
  foldableHeader: {
    minHeight: 42,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  foldableTitle: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "800"
  },
  foldableChevron: {
    color: "#64748b",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 20
  },
  foldableBody: {
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb"
  },
  bullets: {
    gap: 6
  },
  bullet: {
    color: "#334155",
    fontSize: 15,
    lineHeight: 22
  },
  solution: {
    minHeight: 156,
    padding: 14,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    backgroundColor: "#111827"
  },
  solutionHidden: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e5e7eb"
  },
  hiddenText: {
    color: "#4b5563",
    fontSize: 14,
    fontWeight: "700"
  },
  skeletonBlock: {
    gap: 10
  },
  skeletonTitle: {
    color: "#e5e7eb",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 2
  },
  skeletonLine: {
    height: 13,
    width: "72%",
    borderRadius: 4,
    backgroundColor: "#334155"
  },
  skeletonLineWide: {
    width: "92%"
  },
  skeletonLineShort: {
    width: "48%"
  },
  code: {
    color: "#f8fafc",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace"
    }),
    fontSize: 13,
    lineHeight: 19
  },
  codeKeyword: {
    color: "#93c5fd",
    fontWeight: "700"
  },
  codeString: {
    color: "#fde68a"
  },
  codeNumber: {
    color: "#c4b5fd"
  },
  codeComment: {
    color: "#94a3b8"
  },
  practiceLabel: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  practice: {
    minHeight: 132,
    padding: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    color: "#111827",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace"
    }),
    fontSize: 16,
    lineHeight: 22
  },
  bottomSpacer: {
    height: 24
  }
});
