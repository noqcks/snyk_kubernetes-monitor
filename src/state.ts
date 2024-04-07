import { KubernetesObject, V1Namespace } from '@kubernetes/client-node';
import { LRUCache } from 'lru-cache';

import { config } from './common/config';
import { logger } from './common/logger';
import { IKubeObjectMetadataWithoutPodSpec } from './supervisor/types';
import { extractNamespaceName } from './supervisor/watchers/internal-namespaces';

const imagesLruCacheOptions: LRUCache.Options<string, Set<string>> = {
  // limit cache size so we don't exceed memory limit
  max: config.IMAGES_SCANNED_CACHE.MAX_SIZE,
  // limit cache life so if our backend loses track of an image's data,
  // eventually we will report again for that image, if it's still relevant
  maxAge: config.IMAGES_SCANNED_CACHE.MAX_AGE_MS,
  updateAgeOnGet: false,
};

const workloadsLruCacheOptions: LruCache.Options<string, string> = {
  // limit cache size so we don't exceed memory limit
  max: config.WORKLOADS_SCANNED_CACHE.MAX_SIZE,
  // limit cache life so if our backend loses track of an image's data,
  // eventually we will report again for that image, if it's still relevant
  maxAge: config.WORKLOADS_SCANNED_CACHE.MAX_AGE_MS,
  updateAgeOnGet: false,
};

const workloadMetadataLruCacheOptions: LruCache.Options<
  string,
  IKubeObjectMetadataWithoutPodSpec
> = {
  max: config.WORKLOAD_METADATA_CACHE.MAX_SIZE,
  maxAge: config.WORKLOAD_METADATA_CACHE.MAX_AGE_MS,
  updateAgeOnGet: false,
};

interface WorkloadAlreadyScanned {
  namespace: string;
  type: string;
  uid: string;
}

interface WorkloadImagesAlreadyScanned {
  namespace: string;
  type: string;
  uid: string;
  imageIds: string[];
}

function getWorkloadImageAlreadyScannedKey(
  workload: WorkloadAlreadyScanned,
  imageName: string,
): string {
  return `${workload.uid}/${imageName}`;
}

export function getWorkloadAlreadyScanned(
  workload: WorkloadAlreadyScanned,
): string | undefined {
  const key = workload.uid;
  return state.workloadsAlreadyScanned.get(key);
}

export function setWorkloadAlreadyScanned(
  workload: WorkloadAlreadyScanned,
  revision: string,
): boolean {
  const key = workload.uid;
  return state.workloadsAlreadyScanned.set(key, revision);
}

export function deleteWorkloadAlreadyScanned(
  workload: WorkloadAlreadyScanned,
): void {
  const key = workload.uid;
  state.workloadsAlreadyScanned.del(key);
}

export function getWorkloadImageAlreadyScanned(
  workload: WorkloadAlreadyScanned,
  imageName: string,
  imageId: string,
): string | undefined {
  const key = getWorkloadImageAlreadyScannedKey(workload, imageName);
  const hasImageId = state.imagesAlreadyScanned.get(key)?.has(imageId);
  const response = hasImageId ? imageId : undefined;
  if (response !== undefined) {
    logger.debug(
      { 'kubernetes-monitor': { imageId } },
      'image already exists in cache',
    );
  }
  return response;
}

export function setWorkloadImageAlreadyScanned(
  workload: WorkloadAlreadyScanned,
  imageName: string,
  imageId: string,
): boolean {
  const key = getWorkloadImageAlreadyScannedKey(workload, imageName);
  const images = state.imagesAlreadyScanned.get(key);
  if (images !== undefined) {
    images.add(imageId);
  } else {
    const set = new Set<string>();
    set.add(imageId);
    state.imagesAlreadyScanned.set(key, set);
  }

  return true;
}

export function deleteWorkloadImagesAlreadyScanned(
  workload: WorkloadImagesAlreadyScanned,
): void {
  for (const imageId of workload.imageIds) {
    const key = getWorkloadImageAlreadyScannedKey(workload, imageId);
    state.imagesAlreadyScanned.del(key);
  }
}

export function kubernetesObjectToWorkloadAlreadyScanned(
  workload: KubernetesObject,
): WorkloadAlreadyScanned | undefined {
  if (
    workload.metadata &&
    workload.metadata.namespace &&
    workload.metadata.uid &&
    workload.kind
  ) {
    return {
      namespace: workload.metadata.namespace,
      type: workload.kind,
      uid: workload.metadata.uid,
    };
  }
  return undefined;
}

export function storeNamespace(namespace: V1Namespace): void {
  const namespaceName = extractNamespaceName(namespace);
  state.watchedNamespaces[namespaceName] = namespace;
}

export function deleteNamespace(namespace: V1Namespace): void {
  const namespaceName = extractNamespaceName(namespace);
  delete state.watchedNamespaces[namespaceName];
}

function getWorkloadMetadataCacheKey(
  workloadName: string,
  namespace: string,
): string {
  return `${namespace}/${workloadName}`;
}

export function getCachedWorkloadMetadata(
  workloadName: string,
  namespace: string,
): IKubeObjectMetadataWithoutPodSpec | undefined {
  const key = getWorkloadMetadataCacheKey(workloadName, namespace);
  const cachedMetadata = state.workloadMetadata.get(key);
  return cachedMetadata;
}

export function setCachedWorkloadMetadata(
  workloadName: string,
  namespace: string,
  metadata: IKubeObjectMetadataWithoutPodSpec,
): void {
  const key = getWorkloadMetadataCacheKey(workloadName, namespace);
  state.workloadMetadata.set(key, metadata);
}

export const state = {
  shutdownInProgress: false,
  imagesAlreadyScanned: new LruCache<string, Set<string>>(
    imagesLruCacheOptions,
  ),
  workloadsAlreadyScanned: new LruCache<string, string>(
    workloadsLruCacheOptions,
  ),
  watchedNamespaces: {} as Record<string, V1Namespace>,
  workloadMetadata: new LruCache<string, IKubeObjectMetadataWithoutPodSpec>(
    workloadMetadataLruCacheOptions,
  ),
};
