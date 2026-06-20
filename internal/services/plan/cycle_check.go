// cycle_check.go — circular link prevention for the activity link graph.
//
// REQ-F-042: "Links are directional (source → target). Circular links are
// prevented." The existing schema has a CHECK (source_id <> target_id) for
// self-links, but longer cycles (A→B→C→A) are not caught there.
//
// hasCycle is called by CreateActivityLink in service.go immediately after the
// self-link and cross-plan checks, before any INSERT:
//
//	hasCycle, err := s.hasCycle(ctx, req.TargetID, sourceID)
//	if err != nil {
//	    return nil, fmt.Errorf("cycle check: %w", err)
//	}
//	if hasCycle {
//	    return nil, fmt.Errorf("this link would create a cycle")
//	}
package plansvc

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// hasCycle reports whether adding the edge sourceID → targetID would introduce
// a cycle in the existing link graph. It does this by checking whether
// targetID can already reach sourceID via the existing links — if so, adding
// the reverse edge closes a loop.
//
// The BFS is bounded to maxDepth (50) to guard against pathological graphs
// without an unlimited DB query loop. In practice, strategic plan activity
// graphs are shallow (typically depth 2–5), so 50 is effectively unbounded
// for real data.
func (s *Service) hasCycle(ctx context.Context, targetID, sourceID uuid.UUID) (bool, error) {
	const maxDepth = 50

	visited := make(map[uuid.UUID]bool)
	frontier := []uuid.UUID{targetID}

	for depth := 0; len(frontier) > 0 && depth < maxDepth; depth++ {
		current := frontier
		frontier = nil

		for _, node := range current {
			if node == sourceID {
				// targetID can already reach sourceID — adding sourceID→targetID creates a cycle.
				return true, nil
			}
			if visited[node] {
				continue
			}
			visited[node] = true

			// Fetch all nodes reachable in one step from node.
			rows, err := s.db.Query(ctx,
				`SELECT target_id FROM activity_links WHERE source_id = $1`,
				node,
			)
			if err != nil {
				return false, fmt.Errorf("query links from %s: %w", node, err)
			}
			for rows.Next() {
				var next uuid.UUID
				if err := rows.Scan(&next); err != nil {
					rows.Close()
					return false, err
				}
				frontier = append(frontier, next)
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return false, err
			}
		}
	}

	return false, nil
}
