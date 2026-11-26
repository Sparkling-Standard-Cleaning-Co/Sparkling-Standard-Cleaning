-- Add Pensacola ZIP 32534 to the live branch coverage. 32534 is a valid
-- Pensacola residential ZIP that was missing from the ZIP reference and the
-- production branch service-area list, causing valid residential addresses to
-- be classified out-of-area and the calendar to stay empty.
UPDATE branches
SET service_area_json = json_insert(service_area_json, '$.zips[#]', '32534'),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'branch_pensacola'
  AND instr(COALESCE(service_area_json, ''), '32534') = 0;
