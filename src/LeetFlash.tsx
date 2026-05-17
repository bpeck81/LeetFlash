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
import type { ProblemPage } from "./lib/problemFeed";
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
const codeNoWrapStyle =
  Platform.OS === "web" ? ({ whiteSpace: "pre", flexShrink: 0 } as object) : null;
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
const missingExamplesText = "Getting examples with AI.";
const missingConstraintsText = "Getting constraints with AI.";

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
  const requestedSolutionIds = useRef(new Set<number>());
  const loadedSolutionIds = useRef(new Set<number>());
  const pendingScrollQuestionId = useRef<number | null>(null);
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
  const [cardIds, setCardIds] = useState<number[]>([
    initialQuestionId,
    nextQuestionId(initialQuestionId, readStoredValue(randomModeKey) === "true"),
    nextQuestionId(initialQuestionId + 1, readStoredValue(randomModeKey) === "true")
  ]);
  const [problemMap, setProblemMap] = useState<Record<number, LeetProblem>>({});

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchProblemPage(pageParam),
    initialPageParam: initialCursor,
    getNextPageParam: (lastPage: Awaited<ReturnType<typeof fetchProblemPage>>) =>
      lastPage.nextCursor ?? undefined
  });

  const queriedProblems = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data]
  );

  useEffect(() => {
    if (queriedProblems.length === 0) return;

    setProblemMap((current) => {
      const next = { ...current };
      queriedProblems.forEach((problem) => {
        next[problem.id] = problem;
      });
      return next;
    });
  }, [queriedProblems]);

  const problems = cardIds.map((id) => problemMap[id] ?? makeLoadingProblem(id));
  const activeQuestionId = cardIds[index] ?? initialQuestionId;
  const activeProblem = problemMap[activeQuestionId];

  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", ({ window }) => {
      setWidth(window.width);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (cardIds.length > 0 && cardIds.length - index <= 2) {
      appendNextCard();
    }
  }, [index, cardIds.length, randomMode]);

  useEffect(() => {
    const pendingId = pendingScrollQuestionId.current;
    if (!pendingId) return;

    const nextIndex = cardIds.findIndex((id) => id === pendingId);
    if (nextIndex < 0) return;

    pendingScrollQuestionId.current = null;
    setActiveIndex(nextIndex);
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ x: nextIndex * width, animated: true });
    });
  }, [cardIds, width]);

  useEffect(() => {
    cardIds.slice(index, index + 3).forEach((id) => {
      if (!problemMap[id]) {
        void fetchProblemPage(id - 1).then((page) => {
          const problem = page.items.find((item) => item.id === id) ?? page.items[0];
          setProblemMap((current) => ({ ...current, [id]: problem }));
          queryClient.setQueryData(queryKey, (existing: typeof query.data) =>
            appendQueryPage(existing, id - 1, { ...page, items: [problem] })
          );
        });
      }
    });
  }, [cardIds, index, problemMap, queryClient]);

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
    const now = Date.now();
    setPageStartedAt(now);
    setElapsedSeconds(0);
    writeStoredValue(lastQuestionKey, String(activeQuestionId));
    writeQuestionUrl(activeQuestionId);
    setJumpInput(String(activeQuestionId));
    setSeen(true);
    writeStoredValue(`leetflash:seen:${activeQuestionId}`, "true");

    if (sessionUserId) {
      void supabase.from("user_settings").upsert({
        user_id: sessionUserId,
        last_question_id: activeQuestionId,
        random_mode: randomMode
      });

      void supabase.from("user_question_progress").upsert({
        user_id: sessionUserId,
        question_id: activeQuestionId,
        seen: true,
        last_seen_at: new Date().toISOString()
      });
    }

    if (activeProblem) {
      void loadOrGenerateSolution(activeProblem);
    }
  }, [activeQuestionId, activeProblem?.id, randomMode, sessionUserId]);

  useEffect(() => {
    cardIds.slice(index, index + 3).forEach((id) => {
      const problem = problemMap[id];
      if (problem && isPlaceholderProblem(problem)) {
        void loadOrGenerateSolution(problem);
      }
    });
  }, [cardIds, index, problemMap, solutionMap]);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - pageStartedAt) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [pageStartedAt]);

  const goTo = (nextIndex: number) => {
    if (cardIds.length === 0) return;

    const clamped = Math.max(0, Math.min(nextIndex, cardIds.length - 1));
    setActiveIndex(clamped);
    listRef.current?.scrollTo({ x: clamped * width, animated: true });
  };

  const setActiveIndex = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(nextIndex, Math.max(cardIds.length - 1, 0)));
    setIndex((current) => {
      if (current === clamped) return current;
      setPageStartedAt(Date.now());
      setElapsedSeconds(0);
      return clamped;
    });
  };

  const syncIndexFromOffset = (offsetX: number, containerWidth = width) => {
    const safeWidth = Math.max(containerWidth, 1);
    setActiveIndex(Math.round(offsetX / safeWidth));
  };

  const goNext = () => {
    if (randomMode) {
      void goToQuestionNumber(randomQuestionId(activeQuestionId));
      return;
    }

    goTo(index + 1);
  };

  const goToQuestionNumber = async (questionId: number) => {
    const normalized = Math.max(1, Math.floor(questionId));
    const existingIndex = cardIds.findIndex((id) => id === normalized);

    if (existingIndex >= 0) {
      goTo(existingIndex);
      return;
    }

    const page = await fetchProblemPage(normalized - 1);
    queryClient.setQueryData(queryKey, (current: typeof query.data) => {
      return appendQueryPage(current, normalized - 1, page);
    });
    const problem = page.items.find((item) => item.id === normalized) ?? page.items[0];
    setProblemMap((current) => ({ ...current, [normalized]: problem }));
    pendingScrollQuestionId.current = normalized;
    setCardIds((current) =>
      current.includes(normalized) ? current : [...current, normalized]
    );
  };

  const appendNextCard = () => {
    setCardIds((current) => {
      const lastId = current[current.length - 1] ?? initialQuestionId;
      const nextId = nextQuestionId(lastId, randomMode, new Set(current));

      if (current.includes(nextId)) return current;

      void fetchProblemPage(nextId - 1).then((page) => {
        const problem = page.items.find((item) => item.id === nextId) ?? page.items[0];
        setProblemMap((map) => ({ ...map, [nextId]: problem }));
        queryClient.setQueryData(queryKey, (existing: typeof query.data) =>
          appendQueryPage(existing, nextId - 1, { ...page, items: [problem] })
        );
      });

      return [...current, nextId];
    });
  };

  const updateSeen = (nextSeen: boolean) => {
    if (!activeQuestionId) return;

    setSeen(nextSeen);
    writeStoredValue(`leetflash:seen:${activeQuestionId}`, String(nextSeen));

    if (sessionUserId) {
      void supabase.from("user_question_progress").upsert({
        user_id: sessionUserId,
        question_id: activeQuestionId,
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
    const currentId = activeQuestionId;
    setRandomMode(nextRandomMode);
    writeStoredValue(randomModeKey, String(nextRandomMode));
    setCardIds([
      currentId,
      nextQuestionId(currentId, nextRandomMode),
      nextQuestionId(currentId + 1, nextRandomMode)
    ]);
    setActiveIndex(0);
    listRef.current?.scrollTo({ x: 0, animated: false });

    if (sessionUserId) {
      void supabase.from("user_settings").upsert({
        user_id: sessionUserId,
        last_question_id: activeProblem?.id ?? null,
        random_mode: nextRandomMode
      });
    }
  };

  const loadOrGenerateSolution = async (problem: LeetProblem) => {
    if (
      solutionMap[problem.id] ||
      generatingIds[problem.id] ||
      requestedSolutionIds.current.has(problem.id) ||
      loadedSolutionIds.current.has(problem.id) ||
      !hasSupabaseConfig
    ) {
      return;
    }

    requestedSolutionIds.current.add(problem.id);

    const existing = await supabase
      .from("question_solutions")
      .select("question_id, prompt, examples, constraints_text, approach, solution, starter_code")
      .eq("question_id", problem.id)
      .maybeSingle();

    if (isCompleteCard(existing.data)) {
      loadedSolutionIds.current.add(problem.id);
      requestedSolutionIds.current.delete(problem.id);
      setSolutionMap((current) => ({
        ...current,
        [problem.id]: existing.data as QuestionSolution
      }));
      return;
    }

    setGeneratingIds((current) => ({ ...current, [problem.id]: true }));
    try {
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
        loadedSolutionIds.current.add(problem.id);
        setSolutionMap((current) => ({
          ...current,
          [problem.id]: generated.data.solution as QuestionSolution
        }));
      }
    } finally {
      requestedSolutionIds.current.delete(problem.id);
      setGeneratingIds((current) => ({ ...current, [problem.id]: false }));
    }
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
                {activeQuestionId ? `#${activeQuestionId}` : "LeetFlash"}
              </Text>
              {activeQuestionId ? <Text style={styles.externalIcon}>↗</Text> : null}
            </View>
          </Pressable>

          <Pressable
            accessibilityLabel="Next problem"
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            onPress={goNext}
          >
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>

        <View style={styles.controlsBar}>
          <View style={styles.timerPill}>
            <Text style={styles.timerText}>{formatElapsed(elapsedSeconds)}</Text>
          </View>

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
                const nextIndex = Math.round(
                  event.nativeEvent.contentOffset.x /
                    Math.max(event.nativeEvent.layoutMeasurement.width, 1)
                );
                syncIndexFromOffset(
                  event.nativeEvent.contentOffset.x,
                  event.nativeEvent.layoutMeasurement.width
                );
                if (cardIds.length - nextIndex <= 2) {
                  appendNextCard();
                }
              }}
              onScrollEndDrag={(event) => {
                const nextIndex = Math.round(
                  event.nativeEvent.contentOffset.x /
                    Math.max(event.nativeEvent.layoutMeasurement.width, 1)
                );
                syncIndexFromOffset(
                  event.nativeEvent.contentOffset.x,
                  event.nativeEvent.layoutMeasurement.width
                );
                listRef.current?.scrollTo({ x: nextIndex * width, animated: true });
              }}
            >
              {problems.map((item, itemIndex) => {
                const renderedItem = withGeneratedCard(item, solutionMap[item.id]);

                return (
                  <View
                    key={`${item.id}-${itemIndex}`}
                    style={[styles.itemFrame, { width, height: listHeight }]}
                  >
                    <ProblemCard
                      problem={renderedItem}
                      height={listHeight}
                      isGeneratingSolution={Boolean(generatingIds[item.id])}
                      foldState={foldState}
                      onToggleFold={updateFoldState}
                    />
                  </View>
                );
              })}
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
  const needsGeneratedCard = isPlaceholderProblem(problem);
  const needsGeneratedPrompt = isPlaceholderPrompt(problem.prompt);
  const examples = problem.examples ?? promptParts.examples;
  const constraints = problem.constraints ?? promptParts.constraints;
  const statement = needsGeneratedPrompt ? "Getting problem with AI." : promptParts.statement;

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
          {isGeneratingSolution && needsGeneratedPrompt ? (
            <MiniSkeleton label="Getting problem with AI" />
          ) : (
            <Text style={styles.prompt}>{statement}</Text>
          )}
        </View>

        <FoldableSection
          title="Examples"
          open={foldState.examples}
          onToggle={() => onToggleFold("examples")}
        >
          {isGeneratingSolution && !examples ? (
            <MiniSkeleton label="Getting examples with AI" />
          ) : (
            <Text style={styles.promptDetail}>{examples || missingExamplesText}</Text>
          )}
        </FoldableSection>

        <FoldableSection
          title="Constraints"
          open={foldState.constraints}
          onToggle={() => onToggleFold("constraints")}
        >
          {isGeneratingSolution && !constraints ? (
            <MiniSkeleton label="Getting constraints with AI" />
          ) : (
            <Text style={styles.promptDetail}>
              {constraints || missingConstraintsText}
            </Text>
          )}
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
          {isGeneratingSolution && needsGeneratedCard ? (
            <MiniSkeleton label="Getting approach with AI" />
          ) : (
            <View style={styles.bullets}>
              {problem.bullets.map((bullet) => (
                <Text key={bullet} style={styles.bullet}>
                  • {bullet}
                </Text>
              ))}
            </View>
          )}
        </FoldableSection>
      </View>

      <View style={styles.section}>
        <FoldableSection
          title="Solution"
          open={foldState.solution}
          onToggle={() => onToggleFold("solution")}
        >
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator
            style={styles.solution}
            contentContainerStyle={styles.solutionContent}
          >
            {isGeneratingSolution ? (
              <SolutionSkeleton />
            ) : (
              <SyntaxHighlightedCode code={problem.solution} />
            )}
          </ScrollView>
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

function MiniSkeleton({ label }: { label: string }) {
  return (
    <View style={styles.skeletonBlock}>
      <Text style={styles.skeletonTitle}>{label}</Text>
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonLineWide]} />
    </View>
  );
}

function randomQuestionId(currentId?: number): number {
  const next = Math.floor(Math.random() * 3934) + 1;
  return next === currentId ? randomQuestionId(currentId) : next;
}

function nextQuestionId(currentId: number, randomMode: boolean, existing = new Set<number>()) {
  if (!randomMode) return currentId >= 3934 ? 1 : currentId + 1;

  let next = randomQuestionId(currentId);
  let attempts = 0;
  while (existing.has(next) && attempts < 20) {
    next = randomQuestionId(currentId);
    attempts += 1;
  }

  return next;
}

function appendQueryPage(
  current: ReturnType<typeof useInfiniteQuery<ProblemPage>>["data"] | undefined,
  pageParam: number,
  page: ProblemPage
) {
  if (!current) {
    return { pageParams: [pageParam], pages: [page] };
  }

  return {
    ...current,
    pageParams: [...current.pageParams, pageParam],
    pages: [...current.pages, page]
  };
}

function makeLoadingProblem(id: number): LeetProblem {
  return {
    id,
    title: `Problem #${id}`,
    difficulty: "Medium",
    slug: `problem-${id}`,
    prompt: "",
    examples: "",
    constraints: "",
    bullets: [],
    solution: "",
    starterCode: "class Solution:\n    def solve(self):\n        ",
    source: "leetcode"
  };
}

function isCompleteCard(card: unknown): card is QuestionSolution {
  const candidate = card as Partial<QuestionSolution> | null;

  return Boolean(
    isUsefulGeneratedText(candidate?.prompt) &&
      isUsefulGeneratedText(candidate?.examples) &&
      isUsefulGeneratedText(candidate?.constraints_text) &&
      isUsefulGeneratedText(candidate?.solution) &&
      candidate?.approach?.length
  );
}

function isUsefulGeneratedText(value?: string) {
  if (!value?.trim()) return false;
  const lower = value.toLowerCase();

  return ![
    "not provided",
    "no explicit examples",
    "examples are not loaded",
    "constraints are not loaded",
    "getting"
  ].some((phrase) => lower.includes(phrase));
}

function withGeneratedCard(problem: LeetProblem, solution?: QuestionSolution) {
  if (!solution) return problem;

  return {
    ...problem,
    prompt: solution.prompt || problem.prompt,
    examples: solution.examples,
    constraints: solution.constraints_text,
    bullets: solution.approach,
    solution: solution.solution,
    starterCode: solution.starter_code,
    hasSolution: true
  };
}

function isPlaceholderProblem(problem: LeetProblem) {
  return (
    isPlaceholderPrompt(problem.prompt) ||
    !problem.solution.trim() ||
    !problem.examples ||
    !problem.constraints
  );
}

function isPlaceholderPrompt(prompt: string) {
  return prompt.includes("premium problem") || !prompt.trim();
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
    <Text selectable style={[styles.code, codeNoWrapStyle]}>
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
    backgroundColor: "#f5f7fb"
  },
  shell: {
    flex: 1,
    alignSelf: "center",
    width: "100%",
    maxWidth: 840,
    backgroundColor: "#f5f7fb"
  },
  topBar: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d8dee9"
  },
  controlsBar: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d8dee9",
    backgroundColor: "#f5f7fb"
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
    height: 36,
    minWidth: 52,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d8dee9",
    borderRadius: 6,
    backgroundColor: "#ffffff"
  },
  timerText: {
    color: "#3b4656",
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
    borderColor: "#d8dee9",
    borderRadius: 6,
    backgroundColor: "#ffffff"
  },
  seenControlChecked: {
    borderColor: "#15aabf",
    backgroundColor: "#e7f8fa"
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: "#9aa6b2",
    borderRadius: 4,
    color: "#0f8a9d",
    textAlign: "center",
    lineHeight: 16,
    fontSize: 13,
    fontWeight: "900"
  },
  checkboxChecked: {
    borderColor: "#15aabf",
    backgroundColor: "#d5f3f7"
  },
  controlText: {
    color: "#3b4656",
    fontSize: 13,
    fontWeight: "800"
  },
  modeControl: {
    height: 36,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d8dee9",
    borderRadius: 6,
    backgroundColor: "#ffffff"
  },
  modeControlActive: {
    borderColor: "#15aabf",
    backgroundColor: "#e7f8fa"
  },
  modeControlTextActive: {
    color: "#0f8a9d"
  },
  jumpControl: {
    marginLeft: "auto",
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d8dee9",
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
    borderLeftColor: "#d8dee9",
    backgroundColor: "#eef2f7"
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
    borderBottomColor: "#d8dee9",
    gap: 12
  },
  sectionLabel: {
    color: "#667085",
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
    color: "#111827",
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
    color: "#0f8a9d",
    backgroundColor: "#d8f5f8"
  },
  metaMedium: {
    color: "#946200",
    backgroundColor: "#fff3c4"
  },
  metaHard: {
    color: "#b42318",
    backgroundColor: "#ffe4e0"
  },
  prompt: {
    color: "#e8edf3",
    fontSize: 16,
    lineHeight: 25
  },
  statementBox: {
    padding: 14,
    borderWidth: 1,
    borderColor: "#263244",
    borderRadius: 8,
    backgroundColor: "#111827"
  },
  promptDetail: {
    color: "#e8edf3",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace"
    }),
    fontSize: 13,
    lineHeight: 20
  },
  followUp: {
    color: "#596579",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700"
  },
  foldable: {
    borderWidth: 1,
    borderColor: "#263244",
    borderRadius: 8,
    backgroundColor: "#111827",
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
    color: "#e8edf3",
    fontSize: 14,
    fontWeight: "800"
  },
  foldableChevron: {
    color: "#94a3b8",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 20
  },
  foldableBody: {
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#263244"
  },
  bullets: {
    gap: 6
  },
  bullet: {
    color: "#e8edf3",
    fontSize: 15,
    lineHeight: 22
  },
  solution: {
    minHeight: 156,
    borderWidth: 1,
    borderColor: "#263244",
    borderRadius: 8,
    backgroundColor: "#111827"
  },
  solutionContent: {
    padding: 14,
    minWidth: "100%"
  },
  solutionHidden: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e6eaf0"
  },
  hiddenText: {
    color: "#596579",
    fontSize: 14,
    fontWeight: "700"
  },
  skeletonBlock: {
    gap: 10
  },
  skeletonTitle: {
    color: "#e8edf3",
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
    color: "#e8edf3",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace"
    }),
    fontSize: 13,
    lineHeight: 19
  },
  codeKeyword: {
    color: "#7dd3fc",
    fontWeight: "700"
  },
  codeString: {
    color: "#facc15"
  },
  codeNumber: {
    color: "#c4b5fd"
  },
  codeComment: {
    color: "#94a3b8"
  },
  practiceLabel: {
    color: "#3b4656",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  practice: {
    minHeight: 132,
    padding: 12,
    borderWidth: 1,
    borderColor: "#d8dee9",
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
