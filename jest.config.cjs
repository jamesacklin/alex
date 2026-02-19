const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

const appConfig = createJestConfig({
  displayName: "app",
  testEnvironment: "jsdom",
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1"
  }
});

module.exports = async () => {
  return appConfig();
};
