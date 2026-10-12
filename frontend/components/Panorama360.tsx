'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

type Props = {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
};

export default function Panorama360({
    videoRef,
    overlayCanvasRef,
}: Props) {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const mount = mountRef.current;
        const video = videoRef.current;
        const overlayCanvas = overlayCanvasRef.current;

        if (!mount || !video || !overlayCanvas) return;

        let animationId = 0;
        let disposed = false;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);

        const width = Math.max(mount.clientWidth, 1);
        const height = Math.max(mount.clientHeight, 1);

        const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1500);
        camera.position.set(0, 0, 0.1);

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height);
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.touchAction = 'none';
        renderer.domElement.style.width = '100%';
        mount.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.enablePan = false;
        controls.dampingFactor = 0.06;
        controls.rotateSpeed = -0.35;
        controls.minDistance = 0.1;
        controls.maxDistance = 0.1;
        controls.target.set(0, 0, 0);

        const videoGeometry = new THREE.SphereGeometry(500, 96, 64);
        videoGeometry.scale(-1, 1, 1);

        const videoTexture = new THREE.VideoTexture(video);
        videoTexture.colorSpace = THREE.SRGBColorSpace;
        videoTexture.generateMipmaps = false;
        videoTexture.magFilter = THREE.LinearFilter;
        videoTexture.minFilter = THREE.LinearFilter;

        const videoMaterial = new THREE.MeshBasicMaterial({
            map: videoTexture,
            side: THREE.FrontSide,
            toneMapped: false,
        });

        const videoSphere = new THREE.Mesh(videoGeometry, videoMaterial);
        scene.add(videoSphere);

        const overlayGeometry = new THREE.SphereGeometry(498, 96, 64);
        overlayGeometry.scale(-1, 1, 1);

        const overlayTexture = new THREE.CanvasTexture(overlayCanvas);
        overlayTexture.colorSpace = THREE.SRGBColorSpace;
        overlayTexture.generateMipmaps = false;
        overlayTexture.magFilter = THREE.NearestFilter;
        overlayTexture.minFilter = THREE.NearestFilter;

        const overlayMaterial = new THREE.MeshBasicMaterial({
            alphaTest: 0.01,
            depthTest: false,
            depthWrite: false,
            map: overlayTexture,
            opacity: 1,
            side: THREE.FrontSide,
            toneMapped: false,
            transparent: true,
        });

        const overlaySphere = new THREE.Mesh(overlayGeometry, overlayMaterial);
        overlaySphere.renderOrder = 10;
        scene.add(overlaySphere);

        const resize = () => {
            if (disposed) return;

            const nextWidth = mount.clientWidth;
            const nextHeight = mount.clientHeight;
            if (!nextWidth || !nextHeight) return;

            camera.aspect = nextWidth / nextHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(nextWidth, nextHeight);
        };

        const render = () => {
            if (disposed) return;

            animationId = window.requestAnimationFrame(render);
            overlayTexture.needsUpdate = true;
            controls.update();
            renderer.render(scene, camera);
        };

        const observer = new ResizeObserver(resize);
        observer.observe(mount);
        render();

        return () => {
            disposed = true;
            window.cancelAnimationFrame(animationId);
            observer.disconnect();
            controls.dispose();

            scene.remove(videoSphere);
            scene.remove(overlaySphere);
            videoGeometry.dispose();
            videoTexture.dispose();
            videoMaterial.dispose();
            overlayGeometry.dispose();
            overlayTexture.dispose();
            overlayMaterial.dispose();

            renderer.dispose();
            renderer.domElement.remove();
        };
    }, [overlayCanvasRef, videoRef]);

    return (
        <div
            ref={mountRef}
            className="h-[min(65vh,650px)] min-h-80 w-full overflow-hidden rounded-lg bg-black"
            style={{
                cursor: 'grab',
                touchAction: 'none',
            }}
        />
    );
}
