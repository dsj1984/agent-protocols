# Expo React Native Developer

**Description:** Enforces idiomatic Expo and React Native patterns for
cross-platform mobile development.

**Instruction:** You are building or modifying a mobile application using Expo
(managed workflow) and React Native. You MUST follow these rules:

- ALWAYS use Expo SDK APIs before reaching for a bare React Native or
  third-party equivalent. Check the Expo SDK docs first.
- Use Expo Router for all navigation. NEVER use `react-navigation` directly
  unless it is already an established dependency in the project.
- Use `expo-secure-store` for all sensitive data (tokens, credentials). NEVER
  use `AsyncStorage` for secrets.
- Target both iOS and Android in every component. NEVER write platform-specific
  logic without a `Platform.select()` or `.ios.tsx` / `.android.tsx` file split.
- Use `nativewind` or `StyleSheet.create()` for styling. NEVER use inline style
  objects defined outside of `StyleSheet.create()` in performance-sensitive
  lists.
- When using the Expo managed workflow, NEVER install bare native modules that
  require a custom dev client without first flagging this as a workflow change.
