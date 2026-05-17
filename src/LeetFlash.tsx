import { FlashList } from "@shopify/flash-list";
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

const queryKey = ["leet-problems"];
const leetcodeUrl = (slug: string) => `https://leetcode.com/problems/${slug}/`;
const pythonKeywordPattern =
  /\b(class|def|return|for|in|if|elif|else|while|not|or|and|True|False|None|from|import|as|with|pass|break|continue|range|len|enumerate|set|float|int|str|bool|List|Optional)\b/g;
const webScrollStyle =
  Platform.OS === "web"
    ? ({ overflowY: "auto", overflowX: "hidden" } as object)
    : null;

export function LeetFlash() {
  const queryClient = useQueryClient();
  const listRef = useRef<FlashList<LeetProblem>>(null);
  const [width, setWidth] = useState(Dimensions.get("window").width);
  const [listHeight, setListHeight] = useState(
    Math.max(Dimensions.get("window").height - 56, 320)
  );
  const [index, setIndex] = useState(0);
  const [showSolution, setShowSolution] = useState(true);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchProblemPage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage: Awaited<ReturnType<typeof fetchProblemPage>>) =>
      lastPage.nextCursor ?? undefined
  });

  const problems = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data]
  );

  const activeProblem = problems[index];

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

  const goTo = (nextIndex: number) => {
    if (problems.length === 0) return;

    const clamped = Math.max(0, Math.min(nextIndex, problems.length - 1));
    setIndex(clamped);
    listRef.current?.scrollToIndex({ index: clamped, animated: true });
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

          <Pressable
            accessibilityLabel="Next problem"
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            onPress={() => goTo(index + 1)}
          >
            <Text style={styles.chevron}>›</Text>
          </Pressable>
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
            <FlashList
              ref={listRef}
              data={problems}
              horizontal
              pagingEnabled
              bounces={false}
              estimatedItemSize={Math.max(width, 320)}
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item, itemIndex) => `${item.id}-${itemIndex}`}
              onEndReachedThreshold={0.7}
              onEndReached={() => {
                if (query.hasNextPage && !query.isFetchingNextPage) {
                  void query.fetchNextPage();
                }
              }}
              onMomentumScrollEnd={(event) => {
                const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
                setIndex(nextIndex);
              }}
              renderItem={({ item }) => (
                <View style={[styles.itemFrame, { width, height: listHeight }]}>
                  <ProblemCard
                    problem={item}
                    height={listHeight}
                    showSolution={showSolution}
                    onToggleSolution={() => setShowSolution((value) => !value)}
                  />
                </View>
              )}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

type ProblemCardProps = {
  problem: LeetProblem;
  height: number;
  showSolution: boolean;
  onToggleSolution: () => void;
};

function ProblemCard({
  problem,
  height,
  showSolution,
  onToggleSolution
}: ProblemCardProps) {
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [constraintsOpen, setConstraintsOpen] = useState(false);
  const promptParts = useMemo(() => splitProblemPrompt(problem.prompt), [problem.prompt]);

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
            <Text style={styles.meta}>{problem.difficulty}</Text>
          </View>
        </View>

        <Text style={styles.prompt}>{promptParts.statement}</Text>

        {promptParts.examples ? (
          <FoldableSection
            title="Examples"
            open={examplesOpen}
            onToggle={() => setExamplesOpen((value) => !value)}
          >
            <Text style={styles.promptDetail}>{promptParts.examples}</Text>
          </FoldableSection>
        ) : null}

        {promptParts.constraints ? (
          <FoldableSection
            title="Constraints"
            open={constraintsOpen}
            onToggle={() => setConstraintsOpen((value) => !value)}
          >
            <Text style={styles.promptDetail}>{promptParts.constraints}</Text>
          </FoldableSection>
        ) : null}

        {promptParts.followUp ? (
          <Text style={styles.followUp}>{promptParts.followUp}</Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Approach</Text>
        <View style={styles.bullets}>
          {problem.bullets.map((bullet) => (
            <Text key={bullet} style={styles.bullet}>
              • {bullet}
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Solution</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showSolution ? "Hide solution" : "Show solution"}
          style={({ pressed }) => [
            styles.solution,
            !showSolution && styles.solutionHidden,
            pressed && styles.pressed
          ]}
          onPress={onToggleSolution}
        >
          {showSolution ? (
            <SyntaxHighlightedCode code={problem.solution} />
          ) : (
            <Text style={styles.hiddenText}>Solution hidden</Text>
          )}
        </Pressable>
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
        onPress={onToggle}
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
    color: "#64748b",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  prompt: {
    color: "#1f2937",
    fontSize: 16,
    lineHeight: 25
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
    fontSize: 14,
    lineHeight: 20
  },
  bottomSpacer: {
    height: 24
  }
});
