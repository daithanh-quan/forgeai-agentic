# Mobile Profile

Use this profile when the repository is a mobile application.

## Stack signals

- React Native or Expo dependencies
- Flutter files such as `pubspec.yaml`
- Native iOS/Android directories

## Agent focus

- Identify whether the change is JavaScript/TypeScript, Flutter/Dart, or
  native platform code.
- Check navigation, state, permissions, and device APIs.
- Validate platform-specific behavior when touching native integrations.
- Keep UI responsive across screen sizes and accessibility settings.

## Validation

Prefer existing scripts. Common commands:

```bash
npm test
npm run lint
flutter test
```

## Context exclusion hints

These paths are excluded from selected and compiled context unless explicitly
overridden with `--include-excluded`:

- `android/` — native Android platform files
- `ios/` — native iOS platform files
- `.expo/` — Expo build cache
