// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import IslandHost from './IslandHost'

vi.mock('./IslandLayer', () => ({
  default: () => <div data-testid="island-layer" />,
}))

afterEach(cleanup)

describe('IslandHost', () => {
  it('mounts the lazy island layer after the first frame', async () => {
    render(<IslandHost />)

    expect(screen.queryByTestId('island-layer')).toBeNull()

    await waitFor(() => expect(screen.getByTestId('island-layer')).toBeTruthy())
  })
})
