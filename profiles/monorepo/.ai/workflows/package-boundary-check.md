# Package Boundary Check

Use this workflow before changing shared code in a monorepo.

1. Identify the owning package.
2. List direct consumers or dependents when discoverable.
3. Check whether the import path respects workspace rules.
4. Update tests in the owner and affected consumers.
5. Note any package versioning or release impact.
