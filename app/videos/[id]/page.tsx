import { PrototypeApp } from '../../prototype';

export function generateStaticParams() {
  return ['vid-001','vid-002','vid-003','vid-004','vid-005','vid-006','vid-007','vid-008','vid-009','vid-010'].map((id) => ({ id }));
}

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrototypeApp page="video-detail" videoId={id} />;
}
