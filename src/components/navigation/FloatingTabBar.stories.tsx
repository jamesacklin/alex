import type { Meta, StoryObj } from "@storybook/react";
import { FloatingTabBar } from "./FloatingTabBar";

const meta: Meta<typeof FloatingTabBar> = {
  title: "Navigation/FloatingTabBar",
  component: FloatingTabBar,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/library",
        query: {},
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof FloatingTabBar>;

const bookIcon = (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const collectionsIcon = (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

const settingsIcon = (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const defaultItems = [
  { label: "Library", href: "/library", icon: bookIcon },
  { label: "Collections", href: "/collections", icon: collectionsIcon },
  { label: "Settings", href: "/admin/general", icon: settingsIcon },
];

export const LibraryActive: Story = {
  args: { items: defaultItems },
  decorators: [
    (Story) => (
      <div className="relative h-96 bg-background">
        <Story />
      </div>
    ),
  ],
};

export const CollectionsActive: Story = {
  args: { items: defaultItems },
  parameters: {
    nextjs: {
      navigation: {
        pathname: "/collections",
        query: {},
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="relative h-96 bg-background">
        <Story />
      </div>
    ),
  ],
};

export const SettingsActive: Story = {
  args: { items: defaultItems },
  parameters: {
    nextjs: {
      navigation: {
        pathname: "/admin/general",
        query: {},
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="relative h-96 bg-background">
        <Story />
      </div>
    ),
  ],
};
