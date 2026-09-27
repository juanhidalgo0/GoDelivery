import React from 'react';
import { Composition } from 'remotion';
import { Pedidos, Mandados, DURATIONS, FPS } from './Ad.jsx';

export const Root = () => (
  <>
    <Composition id="Pedidos" component={Pedidos} fps={FPS} width={1080} height={1920} durationInFrames={Math.ceil(DURATIONS.Pedidos * FPS)} />
    <Composition id="Mandados" component={Mandados} fps={FPS} width={1080} height={1920} durationInFrames={Math.ceil(DURATIONS.Mandados * FPS)} />
  </>
);
