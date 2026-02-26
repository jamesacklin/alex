import type { Meta, StoryObj } from "@storybook/react";
import type { Book } from "./BookCard";
import { BookCard } from "./BookCard";

const meta: Meta<typeof BookCard> = {
  title: "Library/BookCard",
  component: BookCard,
  parameters: {
    nextjs: {
      appDirectory: true,
    },
  },
  decorators: [
    (Story) => (
      <div className="w-48">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof BookCard>;

const baseBook: Book = {
  id: "book-1",
  title: "Dune",
  author: "Frank Herbert",
  coverPath: null,
  fileType: "epub",
  pageCount: 412,
  updatedAt: Date.now(),
  readingProgress: null,
};

export const NotStarted: Story = {
  args: {
    book: baseBook,
  },
};

export const Reading: Story = {
  args: {
    book: {
      ...baseBook,
      id: "book-2",
      title: "Neuromancer",
      author: "William Gibson",
      fileType: "pdf",
      pageCount: 271,
      readingProgress: {
        status: "reading",
        percentComplete: 42,
        lastReadAt: Date.now() - 3600000,
      },
    },
  },
};

export const Completed: Story = {
  args: {
    book: {
      ...baseBook,
      id: "book-3",
      title: "The Left Hand of Darkness",
      author: "Ursula K. Le Guin",
      fileType: "epub",
      pageCount: 286,
      readingProgress: {
        status: "completed",
        percentComplete: 100,
        lastReadAt: Date.now() - 86400000,
      },
    },
  },
};

export const LongTitle: Story = {
  args: {
    book: {
      ...baseBook,
      id: "book-4",
      title:
        "Do Androids Dream of Electric Sheep? A Novel by Philip K. Dick",
      author: "Philip K. Dick",
      pageCount: 210,
    },
  },
};

export const NoAuthor: Story = {
  args: {
    book: {
      ...baseBook,
      id: "book-5",
      title: "Anonymous Technical Manual",
      author: null,
      fileType: "pdf",
      pageCount: 89,
    },
  },
};

export const WithAction: Story = {
  args: {
    book: {
      ...baseBook,
      id: "book-6",
      title: "Foundation",
      author: "Isaac Asimov",
      pageCount: 244,
    },
    actionLabel: "Remove",
    onAction: () => {},
  },
};

export const Grid: Story = {
  decorators: [
    () => (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        <BookCard book={baseBook} />
        <BookCard
          book={{
            ...baseBook,
            id: "book-2",
            title: "Neuromancer",
            author: "William Gibson",
            fileType: "pdf",
            pageCount: 271,
            readingProgress: {
              status: "reading",
              percentComplete: 67,
              lastReadAt: Date.now(),
            },
          }}
        />
        <BookCard
          book={{
            ...baseBook,
            id: "book-3",
            title: "The Left Hand of Darkness",
            author: "Ursula K. Le Guin",
            pageCount: 286,
            readingProgress: {
              status: "completed",
              percentComplete: 100,
              lastReadAt: Date.now(),
            },
          }}
        />
        <BookCard
          book={{
            ...baseBook,
            id: "book-4",
            title: "Hyperion",
            author: "Dan Simmons",
            pageCount: 482,
            readingProgress: {
              status: "reading",
              percentComplete: 12,
              lastReadAt: Date.now(),
            },
          }}
        />
      </div>
    ),
  ],
};
