---
name: react-native-implementation
description: Implement React Native changes with correct platform targeting, navigation, and native module boundaries.
---

# React Native Implementation

Use this skill for changes in a React Native or Expo project.

## Checklist

- Identify whether the change is in JS/TS, a native module, or an Expo SDK
  integration.
- Check that navigation paths and screen props are consistent with the
  existing router (React Navigation or Expo Router).
- Keep platform-specific files (`*.ios.ts`, `*.android.ts`) only when
  behavior genuinely differs.
- Validate accessibility, responsive layout, and keyboard behavior for UI
  changes.
- Run `npm test` and confirm all tests pass.
- Check both iOS and Android when touching native integrations.
