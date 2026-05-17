export type LeetProblem = {
  id: number;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  slug: string;
  prompt: string;
  examples?: string;
  constraints?: string;
  bullets: string[];
  solution: string;
  starterCode?: string;
  hasSolution?: boolean;
  source?: "local" | "leetcode";
};

export const PROBLEMS: LeetProblem[] = [
  {
    id: 1,
    title: "Two Sum",
    difficulty: "Easy",
    slug: "two-sum",
    prompt:
      "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. You may assume exactly one solution exists, and you may not use the same element twice.",
    bullets: [
      "Track seen numbers in a map from value to index.",
      "For each number, check whether target - number was seen earlier.",
      "Return as soon as the complement exists."
    ],
    solution: `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}

        for i, num in enumerate(nums):
            need = target - num
            if need in seen:
                return [seen[need], i]

            seen[num] = i`
  },
  {
    id: 121,
    title: "Best Time to Buy and Sell Stock",
    difficulty: "Easy",
    slug: "best-time-to-buy-and-sell-stock",
    prompt:
      "You are given an array prices where prices[i] is the price of a stock on day i. Choose one day to buy and a later day to sell to maximize profit. Return the maximum profit, or 0 if no profit is possible.",
    bullets: [
      "Keep the lowest price seen so far.",
      "At each day, compute profit if selling today.",
      "Update the best profit in one pass."
    ],
    solution: `class Solution:
    def maxProfit(self, prices: List[int]) -> int:
        min_price = float("inf")
        best = 0

        for price in prices:
            min_price = min(min_price, price)
            best = max(best, price - min_price)

        return best`
  },
  {
    id: 217,
    title: "Contains Duplicate",
    difficulty: "Easy",
    slug: "contains-duplicate",
    prompt:
      "Given an integer array nums, return true if any value appears at least twice in the array. Return false if every element is distinct.",
    bullets: [
      "Use a Set for values already visited.",
      "If a value is already in the set, a duplicate exists.",
      "Otherwise add each value and continue."
    ],
    solution: `class Solution:
    def containsDuplicate(self, nums: List[int]) -> bool:
        seen = set()

        for num in nums:
            if num in seen:
                return True
            seen.add(num)

        return False`
  },
  {
    id: 238,
    title: "Product of Array Except Self",
    difficulty: "Medium",
    slug: "product-of-array-except-self",
    prompt:
      "Given an integer array nums, return an array answer such that answer[i] is equal to the product of all elements of nums except nums[i]. Solve it without division in O(n) time.",
    bullets: [
      "Store prefix products in the output array.",
      "Walk from the right with a running suffix product.",
      "Multiply prefix and suffix contributions at each index."
    ],
    solution: `class Solution:
    def productExceptSelf(self, nums: List[int]) -> List[int]:
        answer = [1] * len(nums)
        prefix = 1

        for i, num in enumerate(nums):
            answer[i] = prefix
            prefix *= num

        suffix = 1
        for i in range(len(nums) - 1, -1, -1):
            answer[i] *= suffix
            suffix *= nums[i]

        return answer`
  },
  {
    id: 53,
    title: "Maximum Subarray",
    difficulty: "Medium",
    slug: "maximum-subarray",
    prompt:
      "Given an integer array nums, find the contiguous subarray with the largest sum and return its sum.",
    bullets: [
      "Use Kadane's algorithm.",
      "Either extend the previous subarray or start fresh at current value.",
      "Track the best sum seen after each step."
    ],
    solution: `class Solution:
    def maxSubArray(self, nums: List[int]) -> int:
        current = nums[0]
        best = nums[0]

        for num in nums[1:]:
            current = max(num, current + num)
            best = max(best, current)

        return best`
  },
  {
    id: 70,
    title: "Climbing Stairs",
    difficulty: "Easy",
    slug: "climbing-stairs",
    prompt:
      "You are climbing a staircase with n steps. Each time you can climb either 1 or 2 steps. Return the number of distinct ways to reach the top.",
    bullets: [
      "This is the Fibonacci recurrence.",
      "ways(n) equals ways(n - 1) plus ways(n - 2).",
      "Keep only the previous two counts."
    ],
    solution: `class Solution:
    def climbStairs(self, n: int) -> int:
        one = 1
        two = 1

        for _ in range(2, n + 1):
            one, two = one + two, one

        return one`
  },
  {
    id: 206,
    title: "Reverse Linked List",
    difficulty: "Easy",
    slug: "reverse-linked-list",
    prompt:
      "Given the head of a singly linked list, reverse the list and return the reversed list.",
    bullets: [
      "Maintain previous and current pointers.",
      "Save current.next before rewiring it.",
      "Advance both pointers until current is null."
    ],
    solution: `class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        prev = None
        current = head

        while current:
            nxt = current.next
            current.next = prev
            prev = current
            current = nxt

        return prev`
  },
  {
    id: 20,
    title: "Valid Parentheses",
    difficulty: "Easy",
    slug: "valid-parentheses",
    prompt:
      "Given a string s containing only parentheses, brackets, and braces, determine if the input string is valid. Open brackets must be closed by the same type and in the correct order.",
    bullets: [
      "Push expected closing brackets onto a stack.",
      "When a closing bracket appears, it must match the stack top.",
      "The string is valid only if the stack ends empty."
    ],
    solution: `class Solution:
    def isValid(self, s: str) -> bool:
        stack = []
        pairs = {"(": ")", "[": "]", "{": "}"}

        for char in s:
            if char in pairs:
                stack.append(pairs[char])
            elif not stack or stack.pop() != char:
                return False

        return not stack`
  },
  {
    id: 125,
    title: "Valid Palindrome",
    difficulty: "Easy",
    slug: "valid-palindrome",
    prompt:
      "Given a string s, return true if it is a palindrome after converting uppercase letters to lowercase and removing all non-alphanumeric characters.",
    bullets: [
      "Use two pointers from both ends.",
      "Skip non-alphanumeric characters.",
      "Compare normalized characters until pointers cross."
    ],
    solution: `class Solution:
    def isPalindrome(self, s: str) -> bool:
        left = 0
        right = len(s) - 1

        while left < right:
            while left < right and not s[left].isalnum():
                left += 1
            while left < right and not s[right].isalnum():
                right -= 1

            if s[left].lower() != s[right].lower():
                return False

            left += 1
            right -= 1

        return True`
  },
  {
    id: 3,
    title: "Longest Substring Without Repeating Characters",
    difficulty: "Medium",
    slug: "longest-substring-without-repeating-characters",
    prompt:
      "Given a string s, find the length of the longest substring without repeating characters.",
    bullets: [
      "Use a sliding window with a left boundary.",
      "Store the latest index where each character appeared.",
      "Move left past duplicates and update the max window length."
    ],
    solution: `class Solution:
    def lengthOfLongestSubstring(self, s: str) -> int:
        last_seen = {}
        left = 0
        best = 0

        for right, char in enumerate(s):
            if char in last_seen:
                left = max(left, last_seen[char] + 1)

            last_seen[char] = right
            best = max(best, right - left + 1)

        return best`
  }
];
