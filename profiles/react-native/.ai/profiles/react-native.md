# React Native Profile

Use this profile when the repository is a React Native or Expo application.

## Stack signals

- `react-native` or `expo` in `package.json` dependencies

## Agent focus

- Distinguish JavaScript/TypeScript logic from native platform code.
- Keep business logic platform-agnostic; isolate native modules behind
  abstractions.
- Check navigation (React Navigation or Expo Router) before moving or
  renaming screens.
- Validate on both iOS and Android when touching native integrations,
  permissions, or device APIs.
- Prefer Expo managed workflow APIs over bare native modules unless
  ejection is already complete.

## Validation

```bash
npm test
npm run lint
npx expo start --no-dev  # for Expo projects
```

## Context exclusion hints

Do not include `android/`, `ios/`, `node_modules/`, or `.expo/` in context
unless the task explicitly requires native platform files.
