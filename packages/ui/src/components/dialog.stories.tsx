import type { Meta, StoryObj } from "@storybook/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "./dialog";
import { Button } from "./button";
import { Input } from "./input";
import { Label } from "./label";

const meta: Meta<typeof Dialog> = {
  title: "UI/Dialog",
  component: Dialog,
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Edit Collection</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Collection</DialogTitle>
          <DialogDescription>
            Update the name and description of your collection.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" defaultValue="Science Fiction Classics" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="desc">Description</Label>
            <Input id="desc" defaultValue="Golden age sci-fi novels" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const AddToCollection: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Add to Collection
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to Collection</DialogTitle>
          <DialogDescription>
            Select collections for this book.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {[
            { name: "Science Fiction", description: "Classic sci-fi novels", selected: true },
            { name: "Favorites", description: "My top picks", selected: false },
            { name: "To Read", description: null, selected: false },
          ].map((collection) => (
            <button
              key={collection.name}
              type="button"
              role="checkbox"
              aria-checked={collection.selected}
              className={[
                "w-full flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                collection.selected
                  ? "border-primary/50 bg-primary/5"
                  : "hover:bg-muted/60",
              ].join(" ")}
            >
              <span className="text-primary text-sm font-medium" aria-hidden="true">
                {collection.selected ? "\u2611" : "\u2610"}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium">{collection.name}</span>
                {collection.description && (
                  <span className="block text-sm text-muted-foreground">
                    {collection.description}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
