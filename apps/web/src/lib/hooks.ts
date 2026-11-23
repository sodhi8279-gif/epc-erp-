import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from './api';

/** GET with react-query. Key defaults to the URL. */
export function useApi<T = any>(url: string | null, opts: { key?: QueryKey } = {}) {
  return useQuery<T>({ queryKey: opts.key ?? [url], queryFn: () => api.get<T>(url!), enabled: !!url });
}
/** Mutation that invalidates everything on success (data is highly interlinked; correctness over cache cleverness). */
export function useAction<V = any, R = any>(fn: (v: V) => Promise<R>, opts: { onSuccess?: (r: R) => void } = {}) {
  const qc = useQueryClient();
  return useMutation<R, unknown, V>({ mutationFn: fn, onSuccess: (r) => { qc.invalidateQueries(); opts.onSuccess?.(r); } });
}
/** Current project from the /p/:projectId route, with its company id. */
export function useProject() {
  const { projectId } = useParams();
  const q = useApi<any>(projectId ? `/projects/${projectId}` : null);
  return { projectId: projectId!, project: q.data, companyId: q.data?.companyId as string | undefined, loading: q.isLoading };
}
