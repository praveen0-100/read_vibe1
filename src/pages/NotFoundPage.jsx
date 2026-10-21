import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="page-shell">
      <EmptyState icon={Compass} title="This page wandered off the shelf." description="The link may be broken or the item was removed." action="Back to home" onAction={() => navigate('/')} />
    </div>
  );
}
