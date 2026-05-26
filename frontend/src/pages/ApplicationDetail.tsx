import { Navigate, useParams, useLocation } from 'react-router-dom';
import { useWorkspace } from '@/contexts/WorkspaceContext';

/**
 * /applications/:id forwarder. Routes by active repo:
 *  - Master → straight to the test-case grid.
 *  - Client → overview page (pending updates first, then drill in).
 */
const ApplicationDetail = () => {
  const { id } = useParams();
  const { search } = useLocation();
  const { isMasterRepo } = useWorkspace();
  const target = isMasterRepo ? 'library' : 'client-overview';
  return <Navigate to={`/applications/${id}/${target}${search}`} replace />;
};

export default ApplicationDetail;
