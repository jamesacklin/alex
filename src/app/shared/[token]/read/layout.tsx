export default function SharedReaderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      {children}
    </div>
  );
}
