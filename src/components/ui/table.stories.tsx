import type { Meta, StoryObj } from "@storybook/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";
import { Badge } from "./badge";
import { Button } from "./button";

const meta: Meta<typeof Table> = {
  title: "UI/Table",
  component: Table,
};

export default meta;
type Story = StoryObj<typeof Table>;

const sampleUsers = [
  {
    id: "1",
    email: "admin@example.com",
    displayName: "Admin User",
    role: "admin",
    createdAt: "2024-01-15",
  },
  {
    id: "2",
    email: "jane@example.com",
    displayName: "Jane Doe",
    role: "user",
    createdAt: "2024-03-22",
  },
  {
    id: "3",
    email: "bob@example.com",
    displayName: "Bob Smith",
    role: "user",
    createdAt: "2024-06-10",
  },
];

export const UsersTable: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Display Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sampleUsers.map((user) => (
          <TableRow key={user.id}>
            <TableCell>{user.email}</TableCell>
            <TableCell>{user.displayName}</TableCell>
            <TableCell>
              <Badge
                variant={user.role === "admin" ? "default" : "secondary"}
              >
                {user.role}
              </Badge>
            </TableCell>
            <TableCell>{user.createdAt}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm">
                  Edit
                </Button>
                <Button variant="destructive" size="sm">
                  Delete
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

const sampleBooks = [
  { title: "Dune", author: "Frank Herbert", type: "EPUB", pages: 412 },
  { title: "Neuromancer", author: "William Gibson", type: "PDF", pages: 271 },
  {
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    type: "EPUB",
    pages: 286,
  },
];

export const BooksTable: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Author</TableHead>
          <TableHead>Format</TableHead>
          <TableHead className="text-right">Pages</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sampleBooks.map((book) => (
          <TableRow key={book.title}>
            <TableCell className="font-medium">{book.title}</TableCell>
            <TableCell>{book.author}</TableCell>
            <TableCell>
              <Badge variant="secondary">{book.type}</Badge>
            </TableCell>
            <TableCell className="text-right">{book.pages}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};
