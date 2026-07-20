# React Native Change Workflow

Use this workflow for feature, bug, or refactor work in a React Native or
Expo project.

1. Identify whether the change is JS/TS logic, a navigation update, a
   native module call, or a UI component change.
2. Check navigation routes and screen registration before moving screens.
3. Implement in the smallest scope that satisfies the task; avoid touching
   native platform code unless necessary.
4. Validate UI on both iOS and Android dimensions and orientations.
5. Run `npm test` and confirm all tests pass.
