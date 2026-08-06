# Deliberately empty step root

This directory holds no step-definition source file. It exists so the
fail-closed path — "a scope resolving zero step definitions" — has a step root
that is present but empty, which is the shape a mis-pointed `stepRoots` takes
in practice. Git does not track empty directories, hence this file.
