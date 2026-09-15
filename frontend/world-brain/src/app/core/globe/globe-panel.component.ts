import { Component, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import * as THREE from 'three';

@Component({
  selector: 'gb-globe-panel',
  standalone: true,
  template: `<div #viewport class="globe"></div>`,
  styles: [`.globe { width: 100%; height: 70vh; }`],
})
export class GlobePanelComponent implements AfterViewInit, OnDestroy {
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000);
  private rafId = 0;

  constructor(private el: ElementRef) {}

  ngAfterViewInit(): void {
    const host = this.el.nativeElement.querySelector('.globe');
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(this.renderer.domElement);

    const geometry = new THREE.SphereGeometry(5, 64, 64);
    const material = new THREE.MeshBasicMaterial({
      color: 0x113355,
      wireframe: true,
    });
    this.scene.add(new THREE.Mesh(geometry, material));
    this.camera.position.z = 14;

    const loop = () => {
      this.scene.rotateY(0.0005);
      this.renderer?.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
    this.renderer?.dispose();
  }
}