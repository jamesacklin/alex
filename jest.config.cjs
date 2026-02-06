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

const watcherConfig = {
  displayName: "watcher",
  testEnvironment: "node",
  testMatch: ["<rootDir>/watcher/**/__tests__/**/*.test.(ts|tsx)"],
  transform: {
    "^.+\\.(t|j)sx?$": ["@swc/jest"]
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1"
  }
};

module.exports = async () => {
  const resolvedAppConfig = await appConfig;
  return {
    projects: [resolvedAppConfig, watcherConfig]
  };
};
