import type { Meta, StoryObj } from "@storybook/react";
import type { SharedBook } from "./SharedBookCard";
import { SharedBookCard } from "./SharedBookCard";

const meta: Meta<typeof SharedBookCard> = {
  title: "Library/SharedBookCard",
  component: SharedBookCard,
  parameters: {
    nextjs: {
      appDirectory: true,
    },
  },
  decorators: [
    (Story) => (
      <div className="w-56">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SharedBookCard>;

const baseBook: SharedBook = {
  id: "shared-1",
  title: "Dune",
  author: "Frank Herbert",
  fileType: "epub",
  pageCount: 412,
  coverUrl: "/api/shared/abc123/covers/shared-1",
};

export const Default: Story = {
  args: {
    book: baseBook,
    shareToken: "abc123",
  },
};

export const PdfBook: Story = {
  args: {
    book: {
      ...baseBook,
      id: "shared-2",
      title: "Structure and Interpretation of Computer Programs",
      author: "Harold Abelson",
      fileType: "pdf",
      pageCount: 657,
    },
    shareToken: "abc123",
  },
};

export const NoAuthor: Story = {
  args: {
    book: {
      ...baseBook,
      id: "shared-3",
      title: "Technical Reference Guide",
      author: null,
      fileType: "pdf",
      pageCount: 45,
    },
    shareToken: "abc123",
  },
};

export const SinglePage: Story = {
  args: {
    book: {
      ...baseBook,
      id: "shared-4",
      title: "Quick Reference Card",
      author: null,
      fileType: "pdf",
      pageCount: 1,
    },
    shareToken: "abc123",
  },
};

export const Grid: Story = {
  decorators: [
    () => (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <SharedBookCard book={baseBook} shareToken="abc123" />
        <SharedBookCard
          book={{
            ...baseBook,
            id: "shared-2",
            title: "Neuromancer",
            author: "William Gibson",
            fileType: "pdf",
            pageCount: 271,
          }}
          shareToken="abc123"
        />
        <SharedBookCard
          book={{
            ...baseBook,
            id: "shared-3",
            title: "Snow Crash",
            author: "Neal Stephenson",
            pageCount: 440,
          }}
          shareToken="abc123"
        />
      </div>
    ),
  ],
};
